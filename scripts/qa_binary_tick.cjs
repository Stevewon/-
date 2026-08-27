#!/usr/bin/env node
// QA-only: replicate cron-worker/src/binary-matching.ts binaryMatchingTick()
// against the LOCAL miniflare D1 sqlite, so we can verify the matching-bonus
// end-to-end without deploying the cron worker. Mirrors the production logic
// (rollUp + runMatchForUser) exactly.
const path = require('path');
const { execFileSync } = require('child_process');

// Reuse qadb.cjs's DB resolution by requiring better-sqlite3 the same way.
const Database = require('better-sqlite3');
const fs = require('fs');

function findDb() {
  const base = path.join(process.cwd(), '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  const files = fs.readdirSync(base).filter(f => f.endsWith('.sqlite'));
  for (const f of files) {
    try {
      const db = new Database(path.join(base, f));
      const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
      db.close();
      if (t) return path.join(base, f);
    } catch {}
  }
  throw new Error('no active D1 sqlite with users table found');
}

const db = new Database(findDb());
const MATCH_UNIT_USD = 100;
const DOWNLINE_CAP_MULTIPLE = 2;

function uuid() { return require('crypto').randomUUID(); }
function matchBonusRate(m) {
  if (m >= 100000) return 0.07;
  if (m >= 50000) return 0.06;
  if (m >= 10000) return 0.05;
  if (m >= 5000) return 0.04;
  if (m >= 1000) return 0.03;
  if (m >= 100) return 0.02;
  return 0;
}
function priceOf(sym) {
  const r = db.prepare('SELECT price_usd FROM coins WHERE symbol=?').get(sym);
  const p = Number(r && r.price_usd || 0);
  if (p > 0) return p;
  if (sym === 'USDT' || sym === 'USDC') return 1;
  if (sym === 'QTA') return 0.00357142857;
  return 0;
}

function runMatchForUser(userId, qtaPrice) {
  const vol = db.prepare('SELECT left_usd,right_usd,matched_usd,self_usd FROM binary_volume WHERE user_id=?').get(userId);
  if (!vol) return;
  // OWNER RULE (2026-08-27): no self-stake (self_usd<=0) -> no payout at all.
  const selfUsd = Number(vol.self_usd||0);
  if (selfUsd <= 0) { console.log(`  [blocked] user=${userId} self_usd=0 -> not staked, no bonus`); return; }
  const left = Number(vol.left_usd||0), right = Number(vol.right_usd||0), matched = Number(vol.matched_usd||0);
  const pairable = Math.min(left, right) - matched;
  if (pairable < MATCH_UNIT_USD) return;
  const newMatchUsd = Math.floor(pairable / MATCH_UNIT_USD) * MATCH_UNIT_USD;
  if (newMatchUsd < MATCH_UNIT_USD) return;
  const rate = matchBonusRate(newMatchUsd);
  if (rate <= 0) return;
  const bonusUsd = newMatchUsd * rate;
  const bonusQta = qtaPrice > 0 ? bonusUsd / qtaPrice : 0;
  const newMatchedTotal = matched + newMatchUsd;
  const upd = db.prepare("UPDATE binary_volume SET matched_usd=?, updated_at=datetime('now') WHERE user_id=? AND matched_usd=?").run(newMatchedTotal, userId, matched);
  if (upd.changes === 0) return;
  const w = db.prepare("SELECT id FROM wallets WHERE user_id=? AND coin_symbol='QTA'").get(userId);
  if (!w) db.prepare("INSERT INTO wallets (id,user_id,coin_symbol,available,locked) VALUES (?,?,?,0,0)").run(uuid(), userId, 'QTA');
  db.prepare("UPDATE wallets SET available=available+? WHERE user_id=? AND coin_symbol='QTA'").run(bonusQta, userId);
  db.prepare(`INSERT INTO binary_match_bonuses (id,user_id,matched_usd,rate,bonus_usd,bonus_qta,qta_price,left_total,right_total,matched_total,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`)
    .run(uuid(), userId, newMatchUsd, rate, bonusUsd, bonusQta, qtaPrice, left, right, newMatchedTotal);
  console.log(`  [match] user=${userId} matched=$${newMatchUsd} rate=${rate*100}% bonus=$${bonusUsd.toFixed(2)} (${bonusQta.toFixed(2)} QTA)`);
}

function rollUp(memberId, usdValue, qtaPrice) {
  if (!(usdValue > 0)) return;
  db.prepare(`INSERT INTO binary_volume (user_id,left_usd,right_usd,matched_usd,self_usd,updated_at) VALUES (?,0,0,0,?,datetime('now')) ON CONFLICT(user_id) DO UPDATE SET self_usd=self_usd+?, updated_at=datetime('now')`).run(memberId, usdValue, usdValue);
  const seen = new Set([memberId]);
  let childId = memberId, depth = 0;
  while (depth < 200) {
    depth++;
    const node = db.prepare('SELECT binary_parent_id,binary_leg FROM users WHERE id=?').get(childId);
    const parentId = node && node.binary_parent_id;
    const leg = (node && node.binary_leg === 'R') ? 'R' : 'L';
    if (!parentId || seen.has(parentId)) break;
    seen.add(parentId);
    db.prepare(`INSERT INTO binary_volume (user_id,left_usd,right_usd,matched_usd,self_usd,updated_at) VALUES (?,0,0,0,0,datetime('now')) ON CONFLICT(user_id) DO NOTHING`).run(parentId);
    const cur = db.prepare('SELECT left_usd,right_usd,self_usd FROM binary_volume WHERE user_id=?').get(parentId);
    const left = Number(cur.left_usd||0), right = Number(cur.right_usd||0), selfUsd = Number(cur.self_usd||0);
    const cap = selfUsd * DOWNLINE_CAP_MULTIPLE;
    const room = Math.max(0, cap - (left + right));
    const add = Math.min(usdValue, room);
    if (add > 0) {
      const col = leg === 'R' ? 'right_usd' : 'left_usd';
      db.prepare(`UPDATE binary_volume SET ${col}=${col}+?, updated_at=datetime('now') WHERE user_id=?`).run(add, parentId);
      runMatchForUser(parentId, qtaPrice);
    }
    childId = parentId;
  }
}

function tick() {
  let processed = 0;
  const qtaPrice = priceOf('QTA');
  // internal completed deposits, not yet counted, excluding admin-* tx
  const rows = db.prepare("SELECT id,user_id,coin_symbol,amount,tx_hash FROM deposits WHERE status='completed' AND binary_counted_at IS NULL ORDER BY created_at ASC LIMIT 200").all();
  for (const d of rows) {
    const claim = db.prepare("UPDATE deposits SET binary_counted_at=datetime('now') WHERE id=? AND binary_counted_at IS NULL").run(d.id);
    if (claim.changes === 0) continue;
    if (String(d.tx_hash||'').startsWith('admin-')) continue;
    const px = priceOf(String(d.coin_symbol||'USDT').toUpperCase());
    const usd = Number(d.amount||0) * px;
    console.log(`[deposit] user=${d.user_id} ${d.amount} ${d.coin_symbol} = $${usd.toFixed(2)} (tx=${d.tx_hash})`);
    rollUp(d.user_id, usd, qtaPrice);
    processed++;
  }
  return processed;
}

const n = tick();
console.log(`\n[tick done] processed ${n} deposit(s)`);
db.close();
