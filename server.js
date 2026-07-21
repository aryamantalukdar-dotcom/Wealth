'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { db, init } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ---- auth (single shared password) ----------------------------------------

const PASSWORD = process.env.APP_PASSWORD || 'changeme';
if (PASSWORD === 'changeme') {
  console.warn('[wealth] WARNING: using default password "changeme". Set APP_PASSWORD.');
}
const COOKIE = 'wealth_auth';
// Cookie stores a hash of the password, never the password itself.
const TOKEN = crypto.createHash('sha256').update(PASSWORD).digest('hex');

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  const found = header
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + '='));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

function isAuthed(req) {
  return readCookie(req, COOKIE) === TOKEN;
}

app.post('/api/login', (req, res) => {
  const pw = String((req.body || {}).password || '');
  if (pw && crypto.timingSafeEqual(Buffer.from(pw.padEnd(64)), Buffer.from(PASSWORD.padEnd(64)))) {
    const thirtyDays = 60 * 60 * 24 * 30;
    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=${TOKEN}; HttpOnly; Path=/; Max-Age=${thirtyDays}; SameSite=Lax`
    );
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Wrong password' });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
  res.json({ ok: true });
});

// Login page is reachable without auth.
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Gate everything else. The PWA manifest and icons stay public: browsers fetch
// the manifest without cookies, so gating them would silently break
// add-to-home-screen installability (and they contain nothing sensitive).
app.use((req, res, next) => {
  if (isAuthed(req)) return next();
  if (req.path === '/manifest.webmanifest' || req.path.startsWith('/icons/')) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  return res.redirect('/login');
});

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
app.get('/api/data', async (req, res, next) => {
  try {
    const partners = (await db.execute('SELECT id, name FROM partners ORDER BY id')).rows;
    const entries = (
      await db.execute('SELECT * FROM entries ORDER BY month ASC, partner_id ASC')
    ).rows;
    const targets = (await db.execute('SELECT * FROM targets ORDER BY year')).rows;
    res.json({ partners, entries, targets, currency: 'GBP' });
  } catch (e) {
    next(e);
  }
});

// Rename a partner.
app.put('/api/partners/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const info = await db.execute({
      sql: 'UPDATE partners SET name = ? WHERE id = ?',
      args: [name, id],
    });
    if (info.rowsAffected === 0) return res.status(404).json({ error: 'Partner not found' });
    res.json({ id, name });
  } catch (e) {
    next(e);
  }
});

// Create or update a month's figures for a partner (upsert on partner_id + month).
app.post('/api/entries', async (req, res, next) => {
  try {
    const b = req.body || {};
    const partner_id = Number(b.partner_id);
    if (![1, 2].includes(partner_id)) {
      return res.status(400).json({ error: 'Invalid partner' });
    }
    if (!isMonth(b.month)) {
      return res.status(400).json({ error: 'Month must be in YYYY-MM format' });
    }

    const args = {
      partner_id,
      month: b.month,
      current_account: num(b.current_account),
      credit_card: Math.abs(num(b.credit_card)), // always stored as a positive amount owed
      cash_savings: num(b.cash_savings),
      investments: num(b.investments),
      monthly_saved: num(b.monthly_saved),
      updated_at: new Date().toISOString(),
    };

    await db.execute({
      sql: `INSERT INTO entries
         (partner_id, month, current_account, credit_card, cash_savings, investments, monthly_saved, updated_at)
       VALUES
         (:partner_id, :month, :current_account, :credit_card, :cash_savings, :investments, :monthly_saved, :updated_at)
       ON CONFLICT(partner_id, month) DO UPDATE SET
         current_account = :current_account,
         credit_card     = :credit_card,
         cash_savings    = :cash_savings,
         investments     = :investments,
         monthly_saved   = :monthly_saved,
         updated_at      = :updated_at`,
      args,
    });

    const saved = (
      await db.execute({
        sql: 'SELECT * FROM entries WHERE partner_id = ? AND month = ?',
        args: [partner_id, b.month],
      })
    ).rows[0];
    res.json(saved);
  } catch (e) {
    next(e);
  }
});

// Delete a month's entry.
app.delete('/api/entries/:id', async (req, res, next) => {
  try {
    const info = await db.execute({
      sql: 'DELETE FROM entries WHERE id = ?',
      args: [Number(req.params.id)],
    });
    if (info.rowsAffected === 0) return res.status(404).json({ error: 'Entry not found' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Create or update the household targets for a given year (upsert on year).
app.post('/api/targets', async (req, res, next) => {
  try {
    const b = req.body || {};
    const year = Number(b.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'Invalid year' });
    }
    const args = {
      year,
      net_worth_target: Math.max(0, num(b.net_worth_target)),
      monthly_savings_target: Math.max(0, num(b.monthly_savings_target)),
      updated_at: new Date().toISOString(),
    };
    await db.execute({
      sql: `INSERT INTO targets
         (year, net_worth_target, monthly_savings_target, updated_at)
       VALUES
         (:year, :net_worth_target, :monthly_savings_target, :updated_at)
       ON CONFLICT(year) DO UPDATE SET
         net_worth_target       = :net_worth_target,
         monthly_savings_target = :monthly_savings_target,
         updated_at             = :updated_at`,
      args,
    });
    const saved = (
      await db.execute({ sql: 'SELECT * FROM targets WHERE year = ?', args: [year] })
    ).rows[0];
    res.json(saved);
  } catch (e) {
    next(e);
  }
});

// SPA fallback (Express 5 uses a named wildcard).
app.get('/*splat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Wealth dashboard running at http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    console.error('Failed to initialise database:', e);
    process.exit(1);
  });
