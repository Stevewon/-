// Assemble src/i18n/zh.ts from en.ts key order + a translation map.
//   node scripts/i18n_build_zh.cjs <enJson> <zhMapJson> <outFile> <varName>
// - Every EN key is emitted (key order preserved).
// - If zhMap has a translation for the key, it is used; otherwise the EN
//   value is kept as a fallback so no key is ever dropped.
// - Placeholders like {days} and newlines are preserved because we copy
//   the raw string and only swap the value.
const fs = require('fs');

const [, , enJsonPath, zhMapPath, outPath, varName] = process.argv;
const en = JSON.parse(fs.readFileSync(enJsonPath, 'utf8'));
const zh = fs.existsSync(zhMapPath) ? JSON.parse(fs.readFileSync(zhMapPath, 'utf8')) : {};

function esc(s) {
  // Emit as a single-quoted JS string literal.
  return "'" + String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '') + "'";
}

const keys = Object.keys(en);
let translated = 0;
const lines = [`const ${varName} = {`];
for (const k of keys) {
  const hasZh = Object.prototype.hasOwnProperty.call(zh, k) && zh[k] !== null && zh[k] !== '';
  if (hasZh) translated++;
  const val = hasZh ? zh[k] : en[k];
  lines.push(`  ${esc(k)}: ${esc(val)},`);
}
lines.push('};');
lines.push('');
lines.push(`export default ${varName};`);
lines.push('');
fs.writeFileSync(outPath, lines.join('\n'));

console.error(`WROTE ${outPath}`);
console.error(`keys: ${keys.length}, translated: ${translated}, fallback(en): ${keys.length - translated}`);
