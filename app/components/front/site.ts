import { useRouteLoaderData } from "react-router";
import type { FrontMenuItem } from "~/.server/menus";
import type { PageData } from "~/.server/front";
import type { ConsentTexts } from "~/lib/consent";

export type SiteData = {
  lang: string;
  defaultLang: string;
  codes: string[];
  siteName: string;
  menus: Record<string, FrontMenuItem[]>;
  tracking: { ga4Id: string; gtmId: string; clarityId: string };
  consent: ConsentTexts;
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

export type { FrontMenuItem, PageData };
