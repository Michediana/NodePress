// Lingue ISO 639-1 e utility condivise tra server e client.

export const ISO_639_1 = (
  "aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv cy " +
  "da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht " +
  "hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky " +
  "la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny " +
  "oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss " +
  "st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo " +
  "za zh zu"
).split(" ");

/** Normalizza un codice lingua (es. "pt-br" → "pt-BR"). Restituisce null se non valido. */
export function normalizeLangCode(input: string): string | null {
  const raw = input.trim();
  const match = /^([a-zA-Z]{2})(?:[-_]([a-zA-Z]{2}|\d{3}))?$/.exec(raw);
  if (!match) return null;
  const base = match[1].toLowerCase();
  if (!ISO_639_1.includes(base)) return null;
  return match[2] ? `${base}-${match[2].toUpperCase()}` : base;
}

/** Nome leggibile di una lingua, localizzato in `displayLocale`. */
export function languageName(code: string, displayLocale = "it"): string {
  try {
    const name = new Intl.DisplayNames([displayLocale], { type: "language" }).of(code);
    if (name && name !== code) return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {}
  return code;
}

/** Nome della lingua nella lingua stessa (per il selettore lingua del front). */
export function nativeLanguageName(code: string): string {
  return languageName(code, code);
}

export type SiteLanguages = { codes: string[]; defaultLang: string };

/** Prefisso URL per una lingua: vuoto per la lingua di default. */
export function langPrefix(lang: string, defaultLang: string) {
  return lang === defaultLang ? "" : `/${lang}`;
}

/** URL pubblico di un contenuto dato il percorso senza lingua. */
export function localizedUrl(path: string, lang: string, defaultLang: string) {
  const prefix = langPrefix(lang, defaultLang);
  if (path === "/" || path === "") return prefix || "/";
  return `${prefix}${path}`;
}

/** Tutte le lingue ISO 639-1 con nome localizzato, ordinate per nome. */
export function languageOptions(displayLocale = "it") {
  return ISO_639_1.map((code) => ({ code, name: languageName(code, displayLocale) })).sort((a, b) =>
    a.name.localeCompare(b.name, displayLocale),
  );
}
