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

/**
 * Paese della bandiera per ogni lingua (country-flag-icons). Tabella statica, non Intl.Locale.maximize(),
 * perché i dati ICU di Node e browser possono differire e causare errori di idratazione.
 * Le lingue senza un paese di riferimento (esperanto, interlingua…) restano senza bandiera.
 */
const LANGUAGE_FLAGS = Object.fromEntries(
  (
    "aa:ET ab:GE ae:IR af:ZA ak:GH am:ET an:ES ar:SA as:IN av:RU ay:BO az:AZ ba:RU be:BY " +
    "bg:BG bi:VU bm:ML bn:BD bo:CN br:FR bs:BA ca:ES-CT ce:RU ch:GU co:FR cr:CA cs:CZ cu:RU " +
    "cv:RU cy:GB-WLS da:DK de:DE dv:MV dz:BT ee:GH el:GR en:GB es:ES et:EE eu:ES fa:IR ff:SN " +
    "fi:FI fj:FJ fo:FO fr:FR fy:NL ga:IE gd:GB-SCT gl:ES gn:PY gu:IN gv:IM ha:NG he:IL hi:IN " +
    "ho:PG hr:HR ht:HT hu:HU hy:AM hz:NA id:ID ig:NG ii:CN ik:US is:IS it:IT iu:CA ja:JP " +
    "jv:ID ka:GE kg:CD ki:KE kj:NA kk:KZ kl:GL km:KH kn:IN ko:KR kr:NG ks:IN ku:TR kv:RU " +
    "kw:GB ky:KG la:VA lb:LU lg:UG li:NL ln:CD lo:LA lt:LT lu:CD lv:LV mg:MG mh:MH mi:NZ " +
    "mk:MK ml:IN mn:MN mr:IN ms:MY mt:MT my:MM na:NR nb:NO nd:ZW ne:NP ng:NA nl:NL nn:NO " +
    "no:NO nr:ZA nv:US ny:MW oc:FR oj:CA om:ET or:IN os:GE pa:IN pl:PL ps:AF pt:PT qu:PE " +
    "rm:CH rn:BI ro:RO ru:RU rw:RW sa:IN sc:IT sd:PK se:NO sg:CF si:LK sk:SK sl:SI sm:WS " +
    "sn:ZW so:SO sq:AL sr:RS ss:ZA st:ZA su:ID sv:SE sw:TZ ta:IN te:IN tg:TJ th:TH ti:ET " +
    "tk:TM tl:PH tn:ZA to:TO tr:TR ts:ZA tt:RU tw:GH ty:PF ug:CN uk:UA ur:PK uz:UZ ve:ZA " +
    "vi:VN wa:BE wo:SN xh:ZA yi:UA yo:NG za:CN zh:CN zu:ZA"
  )
    .split(" ")
    .map((pair) => pair.split(":") as [string, string]),
);

/** Codice della bandiera di una lingua: la regione se presente (es. "pt-BR" → "BR"), altrimenti il paese tipico. */
export function languageFlag(code: string): string | null {
  const [base, region] = code.split("-");
  if (region && /^[A-Z]{2}$/.test(region)) return region;
  return LANGUAGE_FLAGS[base] ?? null;
}
