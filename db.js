'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.WEALTH_DB || path.join(__dirname, 'data', 'wealth.db');

// Ensure the data directory exists.
require('fs').mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS partners (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS entries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id      INTEGER NOT NULL,
    month           TEXT NOT NULL,               -- 'YYYY-MM'
    current_account REAL NOT NULL DEFAULT 0,
    credit_card     REAL NOT NULL DEFAULT 0,     -- outstanding balance owed (positive number)
    cash_savings    REAL NOT NULL DEFAULT 0,
    investments     REAL NOT NULL DEFAULT 0,
    monthly_saved   REAL NOT NULL DEFAULT 0,     -- amount set aside that month
    updated_at      TEXT NOT NULL,
    UNIQUE(partner_id, month),
    FOREIGN KEY(partner_id) REFERENCES partners(id) ON DELETE CASCADE
  );
`);

// Seed the two partners on first run.
const partnerCount = db.prepare('SELECT COUNT(*) AS n FROM partners').get().n;
if (partnerCount === 0) {
  const insert = db.prepare('INSERT INTO partners (id, name) VALUES (?, ?)');
  insert.run(1, 'Partner 1');
  insert.run(2, 'Partner 2');
}

module.exports = db;
