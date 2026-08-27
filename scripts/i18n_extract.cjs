// Extract i18n key/value pairs from a bundle file (en.ts / ja.ts ...).
// Usage: node scripts/i18n_extract.cjs src/i18n/en.ts [--json]
// Robust to single/double quoted keys & values, escaped quotes, and
// trailing commas. It relies on the actual module default export.
const path = require('path');
const fs = require('fs');

const file = process.argv[2];
if (!file) { console.error('need file'); process.exit(1); }

// Strip TS wrapper and eval as a JS object literal.
let src = fs.readFileSync(file, 'utf8');
// remove `const en = ` ... `; export default en;`
src = src.replace(/^\s*const\s+\w+\s*=\s*/, 'module.exports = ');
src = src.replace(/export\s+default\s+\w+\s*;?\s*$/m, '');
const tmp = path.join('/tmp', 'i18n_tmp_' + Date.now() + '.cjs');
fs.writeFileSync(tmp, src);
const obj = require(tmp);
fs.unlinkSync(tmp);

const keys = Object.keys(obj);
if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(obj, null, 0));
} else {
  console.error('KEY COUNT:', keys.length);
  for (const k of keys) console.log(k + '\t' + String(obj[k]).replace(/\n/g, '\\n'));
}
