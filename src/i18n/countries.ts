/**
 * Country list for the "Where do you live?" residency step at signup
 * (Bybit-style).
 * ─────────────────────────────────────────────────────────────────────────────
 * The selected country is stored on the user's profile (residency_country)
 * and used for compliance/analytics. It does NOT drive the UI language —
 * language is chosen separately in Settings (English default). This keeps the
 * "no Korean-language solicitation" policy intact: a Korean resident can pick
 * "Korea" as residency but the UI stays English unless they switch language
 * to another supported language (Korean is not offered).
 *
 * Note: server-side geo-blocking (middleware/geo-block.ts) is the real
 * enforcement layer. This picker is a self-declaration for onboarding UX,
 * mirroring how Bybit shows a country dropdown on the first screen.
 */

export interface CountryOption {
  /** ISO-3166-1 alpha-2 code. */
  code: string;
  /** English country name shown in the picker. */
  name: string;
  /** Flag emoji. */
  flag: string;
}

function flagEmoji(cc: string): string {
  // Convert a 2-letter country code into its regional-indicator flag emoji.
  const A = 0x1f1e6;
  const c0 = cc.toUpperCase().charCodeAt(0) - 65;
  const c1 = cc.toUpperCase().charCodeAt(1) - 65;
  return String.fromCodePoint(A + c0) + String.fromCodePoint(A + c1);
}

// A broad list of countries, ISO alpha-2. Common markets first for quick
// access, then the rest alphabetically by name.
const RAW: Array<[string, string]> = [
  ['SG', 'Singapore'],
  ['AE', 'United Arab Emirates'],
  ['GB', 'United Kingdom'],
  ['DE', 'Germany'],
  ['FR', 'France'],
  ['ES', 'Spain'],
  ['PT', 'Portugal'],
  ['IT', 'Italy'],
  ['NL', 'Netherlands'],
  ['BR', 'Brazil'],
  ['MX', 'Mexico'],
  ['AR', 'Argentina'],
  ['JP', 'Japan'],
  ['KR', 'Korea'],
  ['CN', 'China'],
  ['HK', 'Hong Kong'],
  ['TW', 'Taiwan'],
  ['VN', 'Vietnam'],
  ['TH', 'Thailand'],
  ['ID', 'Indonesia'],
  ['MY', 'Malaysia'],
  ['PH', 'Philippines'],
  ['IN', 'India'],
  ['TR', 'Turkey'],
  ['SA', 'Saudi Arabia'],
  ['ZA', 'South Africa'],
  ['NG', 'Nigeria'],
  ['EG', 'Egypt'],
  ['AU', 'Australia'],
  ['NZ', 'New Zealand'],
  ['CA', 'Canada'],
  ['US', 'United States'],
  ['RU', 'Russia'],
  ['UA', 'Ukraine'],
  ['PL', 'Poland'],
  ['SE', 'Sweden'],
  ['NO', 'Norway'],
  ['DK', 'Denmark'],
  ['FI', 'Finland'],
  ['CH', 'Switzerland'],
  ['AT', 'Austria'],
  ['BE', 'Belgium'],
  ['IE', 'Ireland'],
  ['GR', 'Greece'],
  ['CZ', 'Czechia'],
  ['RO', 'Romania'],
  ['HU', 'Hungary'],
  ['IL', 'Israel'],
  ['KZ', 'Kazakhstan'],
  ['PK', 'Pakistan'],
  ['BD', 'Bangladesh'],
  ['CL', 'Chile'],
  ['CO', 'Colombia'],
  ['PE', 'Peru'],
];

export const COUNTRIES: CountryOption[] = RAW.map(([code, name]) => ({
  code,
  name,
  flag: flagEmoji(code),
}));

export function getCountryOption(code: string): CountryOption | undefined {
  return COUNTRIES.find((c) => c.code === code.toUpperCase());
}
