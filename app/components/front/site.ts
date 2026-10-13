import { useRouteLoaderData } from "react-router";
import type { FrontMenuItem } from "~/.server/menus";
import type { PageData } from "~/.server/front";
import type { ConsentTexts } from "~/lib/consent";
import type { ThemeBundle } from "~/lib/theme/ast";

export type SiteData = {
  lang: string;
  defaultLang: string;
  codes: string[];
  siteName: string;
  menus: Record<string, FrontMenuItem[]>;
  tracking: { ga4Id: string; gtmId: string; clarityId: string };
  consent: ConsentTexts;
  /** Analytics interne: attive, e se aspettano il consenso del banner. */
  analytics: { enabled: boolean; consent: boolean };
  /** Asset compilati del tema, template per le pagine di errore e tema in anteprima (solo admin). */
  theme: {
    css: string | null;
    js: string | null;
    assets: Record<string, string>;
    notFound: ThemeBundle | null;
    preview: string | null;
  };
};

/** Dati globali del sito (lingua, menu, tracking) per i template. */
export function useSite() {
  return useRouteLoaderData("routes/front/layout") as SiteData;
}

/** Dati della pagina corrente, se esiste (assenti nelle pagine 404). */
export function usePage() {
  const page = useRouteLoaderData("routes/front/page") as PageData | undefined;
  const home = useRouteLoaderData("routes/front/home") as PageData | undefined;
  return page ?? home;
}

/** Voci del menu assegnato a una posizione (es. "header", "footer"). */
export function useMenu(location: string): FrontMenuItem[] {
  return useSite()?.menus[location] ?? [];
}

/** Dati passati ai template: la pagina più nome e URL del sito. */
export type TemplatePage = PageData & { siteName: string; siteUrl: string };

export type { FrontMenuItem, PageData };
