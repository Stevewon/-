#!/usr/bin/env node
// QA-only: apply remaining migrations to the LOCAL miniflare D1 sqlite,
// tolerating idempotent errors (duplicate column, one-off purge blocks that
// reference tables created by later migrations). This mirrors the production
// deploy workflow's `continue-on-error` behaviour so we get a schema that
// matches prod for local end-to-end testing. NOT used in production.
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbDir = path.join(__dirname, '..', '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
const dbFile = fs.readdirSync(dbDir).find(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
const db = new Database(path.join(dbDir, dbFile));
db.pragma('foreign_keys = OFF');

// Which migrations are already recorded?
let applied = new Set();
try {
  applied = new Set(db.prepare('SELECT name FROM d1_migrations').all().map(r => r.name));
} catch { /* table may not exist */ }
db.exec('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)');

const migDir = path.join(__dirname, '..', 'migrations');
const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();

// Tolerated error substrings (idempotent / order-of-one-off-script noise).
const TOLERATE = [
  'duplicate column name',
  'already exists',
  // One-off purge/maintenance blocks embedded in migrations reference tables
  // that later migrations create; on a clean local apply these do not exist
  // yet. The production deploy tolerates the same via continue-on-error.
  'no such table',
  'no such column',
];

// Split a SQL file into statements on ';' at line ends (naive but works for
// these migrations — no stored procedures / semicolons inside strings here).
function splitStatements(sql) {
  // strip both full-line comments and trailing inline `-- ...` comments
  const noComments = sql
    .split('\n')
    .map(l => {
      const t = l.trim();
      if (t.startsWith('--')) return '';
      // remove trailing inline comment (no string literals contain `--` here)
      const idx = l.indexOf('--');
      return idx >= 0 ? l.slice(0, idx) : l;
    })
    .join('\n');
  return noComments.split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);
}

let totalApplied = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const sql = fs.readFileSync(path.join(migDir, file), 'utf8');
  const stmts = splitStatements(sql);
  let tolerated = 0, ran = 0;
  for (const stmt of stmts) {
    try {
      db.prepare(stmt).run();
      ran++;
    } catch (e) {
      const msg = e.message || '';
      if (TOLERATE.some(t => msg.includes(t))) { tolerated++; continue; }
      console.error(`\n[FATAL] ${file}: ${msg}\n  stmt: ${stmt.slice(0, 160)}`);
      process.exit(3);
    }
  }
  db.prepare('INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)').run(file);
  totalApplied++;
  console.log(`applied ${file}  (ran=${ran}, tolerated=${tolerated})`);
}
console.log(`\nDONE. newly applied files: ${totalApplied}`);
db.close();
