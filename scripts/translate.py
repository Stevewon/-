#!/usr/bin/env python3
"""Translate en_extracted.json values into a target language via the LLM API.
Usage: python3 scripts/translate.py <lang_code> <language_name_in_english>
  e.g. python3 scripts/translate.py ja Japanese
Writes scripts/<lang>_translations.json (key -> translated value).
Resumable: skips keys already present in the output file.
"""
import json
import os
import re
import sys
import time
import yaml
from openai import OpenAI

LANG = sys.argv[1] if len(sys.argv) > 1 else 'ja'
LANG_NAME = sys.argv[2] if len(sys.argv) > 2 else 'Japanese'
OUT = f'scripts/{LANG}_translations.json'
BATCH = 40
MODEL = 'gpt-5.1'

cfg = {}
try:
    cfg = yaml.safe_load(open(os.path.expanduser('~/.genspark_llm.yaml'))) or {}
except Exception:
    pass
api_key = os.environ.get('OPENAI_API_KEY') or cfg.get('openai', {}).get('api_key')
base_url = os.environ.get('OPENAI_BASE_URL') or cfg.get('openai', {}).get('base_url')
client = OpenAI(api_key=api_key, base_url=base_url)

en = json.load(open('scripts/en_extracted.json', encoding='utf-8'))

# load existing (resume)
out = {}
if os.path.exists(OUT):
    try:
        out = json.load(open(OUT, encoding='utf-8'))
    except Exception:
        out = {}

# Keep these keys verbatim (brand / tickers / codes) - do NOT translate
KEEP_VERBATIM = re.compile(r'^(QuantaEX|QTA|QX|QKEY|USDT|BTC|ETH|BNB|TRX|2FA|TOTP|IP|API|KYC|VIP|Earn|ADVANCED EARN|STAKE · EARN · GROW)$')

SYSTEM = f"""You are a professional software UI localizer for a cryptocurrency exchange called QuantaEX.
Translate the given English UI strings into {LANG_NAME}.

STRICT RULES:
1. Return ONLY a JSON object mapping each input key to its translated string. No commentary.
2. Preserve ALL placeholder tokens EXACTLY as-is, including curly braces: e.g. {{amount}}, {{days}}, {{krw}}, {{usd}}, {{count}}. Never translate or alter text inside {{ }}.
3. Preserve newline characters (\\n) exactly where they appear.
4. Do NOT translate brand names, ticker symbols or codes: QuantaEX, QTA, QX, QKEY, USDT, BTC, ETH, BNB, TRX, 2FA, TOTP, KYC, API, VIP, TradingView, BscScan, Etherscan.
5. Keep the translation concise and natural for UI buttons/labels — do not add explanations.
6. Numbers, currency symbols ($, ₩), and percentages stay as-is.
7. If a value is purely a symbol, number, or brand token, return it unchanged.
Output must be valid JSON parseable by json.loads."""

def translate_batch(items):
    """items: list of (key, en_value). Returns dict key->translated."""
    payload = {k: v for k, v in items}
    user = "Translate these UI strings to " + LANG_NAME + ". Return JSON only:\n" + json.dumps(payload, ensure_ascii=False)
    for attempt in range(4):
        try:
            resp = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": user},
                ],
                response_format={"type": "json_object"},
            )
            txt = resp.choices[0].message.content
            data = json.loads(txt)
            return data
        except Exception as e:
            print(f"  retry {attempt+1}: {e}", flush=True)
            time.sleep(3 * (attempt + 1))
    raise RuntimeError("batch failed after retries")

# collect keys needing translation
todo = [(k, v) for k, v in en.items() if k not in out]
print(f"Total keys: {len(en)}, already done: {len(out)}, todo: {len(todo)}", flush=True)

for start in range(0, len(todo), BATCH):
    chunk = todo[start:start+BATCH]
    # short-circuit verbatim
    to_send = []
    for k, v in chunk:
        if KEEP_VERBATIM.match(v.strip()):
            out[k] = v
        else:
            to_send.append((k, v))
    if to_send:
        res = translate_batch(to_send)
        for k, _v in to_send:
            if k in res and isinstance(res[k], str):
                out[k] = res[k]
            else:
                print(f"  MISSING in response: {k}", flush=True)
                out[k] = _v  # fallback to english
    # persist after each batch (resumable)
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f"  batch {start//BATCH+1}/{(len(todo)+BATCH-1)//BATCH} done ({len(out)}/{len(en)})", flush=True)

print(f"DONE: {len(out)}/{len(en)} translated -> {OUT}", flush=True)
