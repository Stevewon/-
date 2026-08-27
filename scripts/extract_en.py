#!/usr/bin/env python3
"""Extract all key -> value pairs from src/i18n/en.ts into a JSON dict.
Handles:
  - single-quoted keys: 'key':
  - values single-quoted 'val', double-quoted "val", or on the NEXT line (multiline entries)
  - values containing escaped quotes and curly apostrophes
Preserves duplicates by keeping the LAST occurrence (matches JS object semantics).
"""
import json
import re
import sys

SRC = 'src/i18n/en.ts'

with open(SRC, encoding='utf-8') as f:
    lines = f.readlines()

# key line: leading spaces, 'key': then optional value on same line
key_re = re.compile(r"^\s*'((?:[^'\\]|\\.)+)'\s*:\s*(.*?)\s*$")

def parse_value_literal(s):
    """s is a JS string literal (starts with ' or ") possibly followed by a comma.
    Return the decoded string content."""
    s = s.strip()
    # strip trailing comma
    if s.endswith(','):
        s = s[:-1].rstrip()
    if not s:
        return None
    q = s[0]
    if q not in ("'", '"'):
        return None
    # find matching closing quote respecting escapes
    out = []
    i = 1
    while i < len(s):
        c = s[i]
        if c == '\\':
            nxt = s[i+1] if i+1 < len(s) else ''
            if nxt == 'n':
                out.append('\n')
            elif nxt == 't':
                out.append('\t')
            elif nxt == '\\':
                out.append('\\')
            elif nxt == q:
                out.append(q)
            elif nxt == "'":
                out.append("'")
            elif nxt == '"':
                out.append('"')
            else:
                out.append(nxt)
            i += 2
            continue
        if c == q:
            break
        out.append(c)
        i += 1
    return ''.join(out)

result = {}
i = 0
n = len(lines)
while i < n:
    line = lines[i]
    m = key_re.match(line)
    if not m:
        i += 1
        continue
    key = m.group(1)
    rest = m.group(2)
    if rest == '':
        # value on next line(s)
        i += 1
        val_line = lines[i].strip() if i < n else ''
        val = parse_value_literal(val_line)
    else:
        val = parse_value_literal(rest)
    if val is not None:
        result[key] = val
    i += 1

with open('scripts/en_extracted.json', 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print(f"Extracted {len(result)} unique keys")
