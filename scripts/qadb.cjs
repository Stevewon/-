#!/usr/bin/env node
// Local D1 (miniflare) SQL helper for QA.
//   node scripts/qadb.cjs "SQL"                 -> run one statement (JSON out for SELECT)
//   node scripts/qadb.cjs "SQL1 ;; SQL2"        -> run multiple statements (split on ;;)
// Reads/writes the local miniflare D1 sqlite that `wrangler pages dev --local` uses.
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(
  __dirname,
  '..',
  '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/fb6c8da9a56db03db34492c899dffd54b27a8bddecd6184273c4c801b9e999a3.sqlite',
);

const sqlArg = process.argv[2];
if (!sqlArg) {
  console.error('usage: node scripts/qadb.cjs "SQL"  (multiple: separate with ;;)');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const statements = sqlArg.split(';;').map(s => s.trim()).filter(Boolean);
for (const sql of statements) {
  const isSelect = /^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(sql);
  try {
    if (isSelect) {
      const rows = db.prepare(sql).all();
      console.log(JSON.stringify(rows, null, 2));
    } else {
      const info = db.prepare(sql).run();
      console.log(JSON.stringify({ changes: info.changes, lastRowid: info.lastInsertRowid }));
    }
  } catch (e) {
    console.error('SQL ERROR:', e.message, '\n  in:', sql.slice(0, 120));
    process.exit(2);
  }
}
db.close();
