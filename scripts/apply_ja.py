#!/usr/bin/env python3
"""Rebuild src/i18n/ja.ts from en.ts structure, replacing each value with the
Japanese translation from scripts/ja_final.json.
Line-based: preserves comments, blank lines, formatting. For key lines it
rewrites the value; handles multi-line entries (value on next line).
Emits values as valid TS single-quoted string literals with proper escaping.
"""
import json
import re

en_ts = 'src/i18n/en.ts'
out_ts = 'src/i18n/ja.ts'
ja = json.load(open('scripts/ja_final.json', encoding='utf-8'))

def ts_literal(s):
    # single-quoted TS string; escape backslash, single-quote, newline
    s = s.replace('\\', '\\\\').replace("'", "\\'")
    s = s.replace('\n', '\\n').replace('\r', '')
    s = s.replace('\t', '\\t')
    return "'" + s + "'"

key_re = re.compile(r"^(\s*)'((?:[^'\\]|\\.)+)'\s*:\s*(.*)$")

with open(en_ts, encoding='utf-8') as f:
    lines = f.readlines()

out = []
i = 0
n = len(lines)
replaced = 0
while i < n:
    line = lines[i]
    # header
    if i == 0 and line.startswith('const en'):
        out.append(line.replace('const en', 'const ja', 1))
        i += 1
        continue
    if line.startswith('export default en;'):
        out.append('export default ja;\n')
        i += 1
        continue
    m = key_re.match(line)
    if not m:
        out.append(line)
        i += 1
        continue
    indent, key, rest = m.group(1), m.group(2), m.group(3).strip()
    if key not in ja:
        out.append(line)
        i += 1
        continue
    val_lit = ts_literal(ja[key])
    if rest == '':
        # value on next line -> replace key line + consume next line
        out.append(f"{indent}'{key}':\n")
        out.append(f"{indent}  {val_lit},\n")
        i += 2  # skip the original value line
        replaced += 1
        continue
    # value on same line: keep trailing comma
    trailing = ',' if rest.rstrip().endswith(',') else ''
    out.append(f"{indent}'{key}': {val_lit}{trailing}\n")
    i += 1
    replaced += 1

with open(out_ts, 'w', encoding='utf-8') as f:
    f.writelines(out)

print(f"Rebuilt {out_ts}, replaced {replaced} values")
