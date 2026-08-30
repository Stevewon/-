// ---------------------------------------------------------------------------
// noHangul — block Korean (Hangul) characters from being keyed into inputs.
//
// Boss's rule: signup, KYC, exchange — NOWHERE should a user be able to type
// Korean. This module provides:
//   • stripHangul(str)      : remove any Hangul from a string
//   • hasHangul(str)        : test whether a string contains Hangul
//   • noHangulInputProps()  : spread onto an <input>/<textarea> to block Hangul
//                             at the source (IME composition, paste, keypress)
//                             and mirror the cleaned value back via onChange.
//
// Hangul Unicode ranges covered:
//   AC00–D7A3  Hangul syllables (가–힣)
//   1100–11FF  Hangul Jamo
//   3130–318F  Hangul Compatibility Jamo (ㄱ, ㅏ, …)
//   A960–A97F  Hangul Jamo Extended-A
//   D7B0–D7FF  Hangul Jamo Extended-B
// ---------------------------------------------------------------------------

const HANGUL_RE = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/g;

/** Return true if the string contains any Hangul character. */
export function hasHangul(s: string | null | undefined): boolean {
  if (!s) return false;
  HANGUL_RE.lastIndex = 0;
  return HANGUL_RE.test(s);
}

/** Remove every Hangul character from the string. */
export function stripHangul(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(HANGUL_RE, '');
}

/**
 * Props to spread onto a controlled <input> or <textarea> so the user can
 * never key in Hangul. Works across IME composition, paste, and drop.
 *
 * Usage:
 *   const [name, setName] = useState('');
 *   <input value={name} {...noHangulInputProps(setName)} />
 *
 * If you already have an onChange, pass it and we'll call it with the CLEANED
 * event so your existing logic keeps working:
 *   <input value={x} {...noHangulInputProps((v) => setX(v))} />
 */
export function noHangulInputProps(
  onValue: (cleaned: string) => void,
) {
  const clean = (el: HTMLInputElement | HTMLTextAreaElement) => {
    const raw = el.value;
    const cleaned = stripHangul(raw);
    if (cleaned !== raw) {
      // Keep caret sane: put it at the end of the cleaned value.
      el.value = cleaned;
      try { el.setSelectionRange(cleaned.length, cleaned.length); } catch { /* number inputs */ }
    }
    return cleaned;
  };

  return {
    // Block Hangul as it is composed by the IME (Korean keyboard).
    onCompositionUpdate: (e: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const el = e.currentTarget;
      clean(el);
    },
    onCompositionEnd: (e: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const el = e.currentTarget;
      onValue(clean(el));
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onValue(clean(e.currentTarget));
    },
    onPaste: (e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const text = e.clipboardData?.getData('text') ?? '';
      if (hasHangul(text)) {
        e.preventDefault();
        const el = e.currentTarget;
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        const insert = stripHangul(text);
        const next = el.value.slice(0, start) + insert + el.value.slice(end);
        el.value = next;
        try { el.setSelectionRange(start + insert.length, start + insert.length); } catch { /* ignore */ }
        onValue(next);
      }
    },
  };
}
