import { Outlet } from "react-router";
import { publicUrl, resolveLang } from "~/.server/front";
import { getFrontMenus } from "~/.server/menus";
import { getSettings } from "~/.server/settings";
import { bundleFor, getFrontTheme, previewRedirect } from "~/.server/theme";
import { ConsentBanner, consentDefaultsScript } from "~/components/front/consent";
import type { SiteData } from "~/components/front/site";
import { consentTextsFor } from "~/lib/consent";
import frontCss from "~/front.css?url";
import type { Route } from "./+types/layout";

export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: frontCss }];

export async function loader({ request }: Route.LoaderArgs): Promise<SiteData> {
  const preview = await previewRedirect(request);
  if (preview) throw preview;
  const { lang, defaultLang, codes } = await resolveLang(publicUrl(request).pathname);
  const [settings, theme] = await Promise.all([
    getSettings(["siteName", "ga4Id", "gtmId", "clarityId", "consentTexts"]),
    getFrontTheme(request),
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
      css: theme.data.css,
      js: theme.data.js,
      assets: theme.data.assets,
      notFound: theme.data.files["templates/404.np"] ? bundleFor(theme.data, "templates/404.np") : null,
      preview: theme.preview ? theme.name : null,
    },
  };
}

export default function FrontLayout({ loaderData }: Route.ComponentProps) {
  const { tracking, theme } = loaderData;
  const hasTracking = Boolean(tracking.ga4Id || tracking.gtmId || tracking.clarityId);
  return (
    <>
      {theme.css && <link rel="stylesheet" href={theme.css} precedence="theme" />}
      {theme.js && <script type="module" src={theme.js} async />}
      {hasTracking && <script dangerouslySetInnerHTML={{ __html: consentDefaultsScript() }} />}
      <Outlet />
      <ConsentBanner />
      {theme.preview && (
        <div className="np-preview-badge" role="status">
          Anteprima bozza: <strong>{theme.preview}</strong>
          <a href="?np_preview=off">Esci</a>
        </div>
      )}
    </>
  );
}
