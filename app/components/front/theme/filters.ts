import type { FILTER_NAMES } from "~/lib/theme/ast";
import { nativeLanguageName } from "~/lib/languages";
import type { MediaRef } from "~/lib/media";
import type { SiteData, TemplatePage } from "../site";

export type FilterContext = { site: SiteData; page: TemplatePage | null; media: (id: unknown) => MediaRef | null };

type Filter = (ctx: FilterContext, ...args: unknown[]) => unknown;

const DATE_STYLES = new Set(["full", "long", "medium", "short"]);

const homeUrl = (site: SiteData, lang = site.lang) => (lang === site.defaultLang ? "/" : `/${lang}`);

/** Filtri richiamabili dalle espressioni del tema, es. `date(page.translation.publishedAt, "short")`. */
export const filters: Record<(typeof FILTER_NAMES)[number], Filter> = {
  /** Data localizzata nella lingua corrente. Stile: full, long (default), medium, short. */
  date: ({ site }, value, style = "long") => {
    if (!value) return "";
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(site.lang, {
      dateStyle: DATE_STYLES.has(String(style)) ? (style as "long") : "long",
    });
  },

  /** Anno di una data, o l'anno corrente. */
  year: (_, value) => (value ? new Date(String(value)) : new Date()).getFullYear(),

  /** Voci del menu assegnato a una posizione: `{ label, href, external, newTab, children }`. */
  menu: ({ site }, location) => site.menus[String(location)] ?? [],

  /**
   * Lingue in cui esiste il contenuto corrente: `{ lang, href, name, current }`.
   * Fuori da una pagina di contenuto rimanda alla home di ogni lingua.
   */
  languages: ({ site, page }) => {
    const links = page ? page.alternates : site.codes.map((lang) => ({ lang, href: homeUrl(site, lang) }));
    return links.map((link) => ({ ...link, name: nativeLanguageName(link.lang), current: link.lang === site.lang }));
  },

  /** Nome di una lingua nella lingua stessa (es. "English", "Deutsch"). */
  languageName: (_, code) => nativeLanguageName(String(code ?? "")),

  /** URL della pagina N di un elenco paginato. */
  pageUrl: ({ page }, n) => {
    if (!page) return "";
    const num = Number(n) || 1;
    return num === 1 ? page.url : `${page.url}?page=${num}`;
  },

  /** Home della lingua corrente o di quella indicata. */
  homeUrl: ({ site }, lang) => homeUrl(site, lang ? String(lang) : undefined),

  /** Media referenziato nel contenuto della pagina, dato il suo id. */
  media: ({ media }, id): MediaRef | null => media(id),

  /** URL di un file statico del tema, es. `asset("assets/logo.svg")`. */
  asset: ({ site }, file) => site.theme.assets[String(file ?? "").replace(/^\.?\//, "")] ?? "",
};
