import { Outlet } from "react-router";
import { publicUrl, resolveLang } from "~/.server/front";
import { getFrontMenus } from "~/.server/menus";
import { getSettings } from "~/.server/settings";
import { bundleFor, getTheme, themeCssHref } from "~/.server/theme";
import { ConsentBanner, consentDefaultsScript } from "~/components/front/consent";
import type { SiteData } from "~/components/front/site";
import { consentTextsFor } from "~/lib/consent";
import frontCss from "~/front.css?url";
import type { Route } from "./+types/layout";

export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: frontCss }];

export async function loader({ request }: Route.LoaderArgs): Promise<SiteData> {
  const { lang, defaultLang, codes } = await resolveLang(publicUrl(request).pathname);
  const [settings, theme] = await Promise.all([
    getSettings(["siteName", "ga4Id", "gtmId", "clarityId", "consentTexts"]),
    getTheme(),
  ]);
  return {
    lang,
    defaultLang,
    codes,
    siteName: settings.siteName,
    menus: await getFrontMenus(lang, defaultLang),
    tracking: { ga4Id: settings.ga4Id, gtmId: settings.gtmId, clarityId: settings.clarityId },
    consent: consentTextsFor(lang, settings.consentTexts),
    theme: {
      cssHref: themeCssHref(theme),
      notFound: theme.files["templates/404.np"] ? bundleFor(theme, "templates/404.np") : null,
    },
  };
}

export default function FrontLayout({ loaderData }: Route.ComponentProps) {
  const { tracking, theme } = loaderData;
  const hasTracking = Boolean(tracking.ga4Id || tracking.gtmId || tracking.clarityId);
  return (
    <>
      <link rel="stylesheet" href={theme.cssHref} precedence="theme" />
      {hasTracking && <script dangerouslySetInnerHTML={{ __html: consentDefaultsScript() }} />}
      <Outlet />
      <ConsentBanner />
    </>
  );
}
