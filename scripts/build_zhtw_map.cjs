const fs = require('fs');
const OpenCC = require('opencc-js');
const zh = require('./zh_map.json');

// Simplified (China) -> Traditional (Taiwan) with Taiwan-specific phrase/vocab
const conv = OpenCC.Converter({ from: 'cn', to: 'twp' });

// Post-conversion vocabulary fixes: keep finance/crypto terms in the form
// Taiwanese exchanges actually use, and undo a few over-eager phrase swaps.
const overrides = [
  // Taiwan-standard vocabulary that OpenCC twp does not already normalize.
  ['後臺', '後台'],   // admin console: Taiwan uses 後台
  ['當前', '目前'],   // "current" -> Taiwan prefers 目前
  ['賬戶', '帳戶'],   // account: Taiwan standard is 帳戶
  ['賬號', '帳號'],   // account number
  ['計劃', '計畫'],   // plan/programme -> Taiwan 計畫
  // Kept as-is (widely used in TW crypto industry): 質押 (staking), 充值 (deposit).
];

function fix(s) {
  let out = s;
  for (const [from, to] of overrides) {
    out = out.split(from).join(to);
  }
  return out;
}

const out = {};
let converted = 0, unchanged = 0;
for (const [k, v] of Object.entries(zh)) {
  const tw = fix(conv(v));
  out[k] = tw;
  if (tw !== v) converted++; else unchanged++;
}

fs.writeFileSync(__dirname + '/zhtw_map.json', JSON.stringify(out, null, 2) + '\n');
console.error(`WROTE zhtw_map.json  keys=${Object.keys(out).length} converted=${converted} unchanged=${unchanged}`);
