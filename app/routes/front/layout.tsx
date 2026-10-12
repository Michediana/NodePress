import { Outlet } from "react-router";
import { publicUrl, resolveLang } from "~/.server/front";
import { getFrontMenus } from "~/.server/menus";
import { getSettings } from "~/.server/settings";
import { ConsentBanner, consentDefaultsScript } from "~/components/front/consent";
import type { SiteData } from "~/components/front/site";
import { consentTextsFor } from "~/lib/consent";
import type { Route } from "./+types/layout";

export async function loader({ request }: Route.LoaderArgs): Promise<SiteData> {
  const { lang, defaultLang, codes } = await resolveLang(publicUrl(request).pathname);
  const settings = await getSettings(["siteName", "ga4Id", "gtmId", "clarityId", "consentTexts"]);
  return {
    lang,
    defaultLang,
    codes,
    siteName: settings.siteName,
    menus: await getFrontMenus(lang, defaultLang),
    tracking: { ga4Id: settings.ga4Id, gtmId: settings.gtmId, clarityId: settings.clarityId },
    consent: consentTextsFor(lang, settings.consentTexts),
  };
}

export default function FrontLayout({ loaderData }: Route.ComponentProps) {
  const { tracking } = loaderData;
  const hasTracking = Boolean(tracking.ga4Id || tracking.gtmId || tracking.clarityId);
  return (
    <>
      {hasTracking && <script dangerouslySetInnerHTML={{ __html: consentDefaultsScript() }} />}
      <Outlet />
      <ConsentBanner />
    </>
  );
}
