'use strict';

const { createClient } = require('@libsql/client');

// In production, set TURSO_DATABASE_URL (libsql://...) and TURSO_AUTH_TOKEN.
// Locally, with neither set, we fall back to an on-disk SQLite file so `npm start`
// still works for development.
const url = process.env.TURSO_DATABASE_URL || 'file:data/wealth.db';
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

// Ensure the data directory exists when using a local file DB.
if (url.startsWith('file:')) {
  const path = require('path');
  const fs = require('fs');
  const filePath = path.resolve(url.replace(/^file:/, ''));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

const db = createClient({ url, authToken });

async function init() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS partners (
      id   INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS entries (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id      INTEGER NOT NULL,
      month           TEXT NOT NULL,               -- 'YYYY-MM'
      current_account REAL NOT NULL DEFAULT 0,
      credit_card     REAL NOT NULL DEFAULT 0,     -- outstanding balance owed (positive)
      cash_savings    REAL NOT NULL DEFAULT 0,
      investments     REAL NOT NULL DEFAULT 0,
      monthly_saved   REAL NOT NULL DEFAULT 0,     -- amount set aside that month
      updated_at      TEXT NOT NULL,
      UNIQUE(partner_id, month),
      FOREIGN KEY(partner_id) REFERENCES partners(id) ON DELETE CASCADE
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS targets (
      year                   INTEGER PRIMARY KEY,
      net_worth_target       REAL NOT NULL DEFAULT 0,   -- combined net worth to reach by year end
      monthly_savings_target REAL NOT NULL DEFAULT 0,   -- combined amount to save each month
      updated_at             TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS goals (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      emoji         TEXT NOT NULL DEFAULT '🎯',
      target_amount REAL NOT NULL DEFAULT 0,
      target_month  TEXT,                       -- 'YYYY-MM', optional deadline
      saved_amount  REAL NOT NULL DEFAULT 0,    -- put aside towards this goal so far
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
  `);

  // Additive migrations. SQLite has no "ADD COLUMN IF NOT EXISTS", so check the
  // table shape first. Existing rows keep their data.
  const cols = await db.execute('PRAGMA table_info(entries)');
  const hasCol = (n) => cols.rows.some((c) => c.name === n);

  if (!hasCol('note')) {
    await db.execute(`ALTER TABLE entries ADD COLUMN note TEXT NOT NULL DEFAULT ''`);
  }

  // Money deliberately paid in, split by destination. Everything else about a
  // month (cash left over, debt cleared, market movement) is derived from the
  // balances, so these are the only two figures that have to be declared.
  if (!hasCol('paid_savings')) {
    await db.execute(`ALTER TABLE entries ADD COLUMN paid_savings REAL NOT NULL DEFAULT 0`);
  }
  if (!hasCol('paid_investments')) {
    await db.execute(`ALTER TABLE entries ADD COLUMN paid_investments REAL NOT NULL DEFAULT 0`);
    // One-time backfill, inside the branch that creates the column so it can
    // only ever run once: the old single "saved this month" figure is carried
    // over as money paid into investments.
    if (hasCol('monthly_saved')) {
      await db.execute('UPDATE entries SET paid_investments = monthly_saved');
    }
  }

  // Seed the two partners on first run.
  const res = await db.execute('SELECT COUNT(*) AS n FROM partners');
  if (Number(res.rows[0].n) === 0) {
    await db.execute({ sql: 'INSERT INTO partners (id, name) VALUES (?, ?)', args: [1, 'Partner 1'] });
    await db.execute({ sql: 'INSERT INTO partners (id, name) VALUES (?, ?)', args: [2, 'Partner 2'] });
  }
}

module.exports = { db, init };
