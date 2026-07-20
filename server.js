'use strict';

const path = require('path');
const express = require('express');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- helpers ---------------------------------------------------------------

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// 'YYYY-MM'
const isMonth = (m) => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

// ---- API -------------------------------------------------------------------

// Everything the frontend needs in one call.
app.get('/api/data', (req, res) => {
  const partners = db.prepare('SELECT id, name FROM partners ORDER BY id').all();
  const entries = db
    .prepare('SELECT * FROM entries ORDER BY month ASC, partner_id ASC')
    .all();
  res.json({ partners, entries, currency: 'GBP' });
});

// Rename a partner.
app.put('/api/partners/:id', (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const info = db.prepare('UPDATE partners SET name = ? WHERE id = ?').run(name, id);
  if (info.changes === 0) return res.status(404).json({ error: 'Partner not found' });
  res.json({ id, name });
});

// Create or update a month's figures for a partner (upsert on partner_id + month).
app.post('/api/entries', (req, res) => {
  const b = req.body || {};
  const partner_id = Number(b.partner_id);
  if (![1, 2].includes(partner_id)) {
    return res.status(400).json({ error: 'Invalid partner' });
  }
  if (!isMonth(b.month)) {
    return res.status(400).json({ error: 'Month must be in YYYY-MM format' });
  }

  const row = {
    partner_id,
    month: b.month,
    current_account: num(b.current_account),
    credit_card: Math.abs(num(b.credit_card)), // always stored as a positive amount owed
    cash_savings: num(b.cash_savings),
    investments: num(b.investments),
    monthly_saved: num(b.monthly_saved),
    updated_at: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO entries
       (partner_id, month, current_account, credit_card, cash_savings, investments, monthly_saved, updated_at)
     VALUES
       (@partner_id, @month, @current_account, @credit_card, @cash_savings, @investments, @monthly_saved, @updated_at)
     ON CONFLICT(partner_id, month) DO UPDATE SET
       current_account = @current_account,
       credit_card     = @credit_card,
       cash_savings    = @cash_savings,
       investments     = @investments,
       monthly_saved   = @monthly_saved,
       updated_at      = @updated_at`
  ).run(row);

  const saved = db
    .prepare('SELECT * FROM entries WHERE partner_id = ? AND month = ?')
    .get(partner_id, b.month);
  res.json(saved);
});

// Delete a month's entry.
app.delete('/api/entries/:id', (req, res) => {
  const info = db.prepare('DELETE FROM entries WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'Entry not found' });
  res.json({ ok: true });
});

// SPA fallback (Express 5 uses a named wildcard).
app.get('/*splat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Wealth dashboard running at http://localhost:${PORT}`);
});
