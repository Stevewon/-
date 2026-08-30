// Server-side Hangul (Korean) guard — mirrors src/utils/noHangul.ts on the
// client. Boss's rule: no Korean anywhere (signup, KYC, exchange). The client
// blocks typing, but we ALSO reject/strip on the server so a direct API caller
// can't bypass it.
//
// Hangul Unicode ranges:
//   AC00–D7A3  syllables (가–힣)   1100–11FF  Jamo
//   3130–318F  Compatibility Jamo   A960–A97F  Jamo Ext-A   D7B0–D7FF  Ext-B

const HANGUL_RE = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/;

/** True if the string contains any Hangul character. */
export function hasHangul(s: string | null | undefined): boolean {
  if (!s) return false;
  return HANGUL_RE.test(s);
}

/** Remove every Hangul character from the string. */
export function stripHangul(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(
    /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/g,
    '',
  );
}
