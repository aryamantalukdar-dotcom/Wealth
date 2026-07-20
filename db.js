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

  // Seed the two partners on first run.
  const res = await db.execute('SELECT COUNT(*) AS n FROM partners');
  if (Number(res.rows[0].n) === 0) {
    await db.execute({ sql: 'INSERT INTO partners (id, name) VALUES (?, ?)', args: [1, 'Partner 1'] });
    await db.execute({ sql: 'INSERT INTO partners (id, name) VALUES (?, ?)', args: [2, 'Partner 2'] });
  }
}

module.exports = { db, init };
