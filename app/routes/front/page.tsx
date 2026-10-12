import { isRouteErrorResponse, Link } from "react-router";
import { loadPage } from "~/.server/front";
import { getSettings, getSiteUrl } from "~/.server/settings";
import { getFrontTheme, templateBundle } from "~/.server/theme";
import { useSite } from "~/components/front/site";
import { ThemeRenderer } from "~/components/front/theme/renderer";
import { mediaUrl } from "~/lib/media";
import { kindOfNode } from "~/lib/theme/manifest";
import type { Route } from "./+types/page";

export async function loader({ request }: Route.LoaderArgs) {
  const page = await loadPage(request);
  const [{ siteName }, siteUrl, theme] = await Promise.all([
    getSettings(["siteName"]),
    getSiteUrl(request),
    getFrontTheme(request),
  ]);
  return {
    ...page,
    siteName,
    siteUrl,
    template: templateBundle(theme.data, page.node.template, kindOfNode(page.node.type)),
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "404" }];
  const { translation, siteName, siteUrl, alternates, defaultLang, media, listing, lang } = loaderData;
  const title = translation.seoTitle || (translation.path === "/" ? siteName : `${translation.title} | ${siteName}`);
  const description = translation.seoDescription || translation.excerpt || "";
  const pageSuffix = listing && listing.page > 1 ? `?page=${listing.page}` : "";
  const canonical = siteUrl + loaderData.url + pageSuffix;
  const og = translation.ogImageId ? media[translation.ogImageId] : null;
  const xDefault = alternates.find((a) => a.lang === defaultLang);
  return [
    { title },
    ...(description ? [{ name: "description", content: description }] : []),
    { tagName: "link", rel: "canonical", href: canonical },
    ...(alternates.length > 1
      ? [
          ...alternates.map((a) => ({ tagName: "link", rel: "alternate", hrefLang: a.lang, href: siteUrl + a.href })),
          ...(xDefault
            ? [{ tagName: "link", rel: "alternate", hrefLang: "x-default", href: siteUrl + xDefault.href }]
            : []),
        ]
      : []),
    ...(translation.noindex ? [{ name: "robots", content: "noindex, follow" }] : []),
    { property: "og:type", content: loaderData.node.type === "item" ? "article" : "website" },
    { property: "og:title", content: translation.seoTitle || translation.title },
    ...(description ? [{ property: "og:description", content: description }] : []),
    { property: "og:url", content: canonical },
    { property: "og:site_name", content: siteName },
    { property: "og:locale", content: lang.replace("-", "_") },
    ...(og
      ? [
          { property: "og:image", content: siteUrl + mediaUrl(og.file) },
          { name: "twitter:card", content: "summary_large_image" },
        ]
      : []),
  ];
}

export function headers() {
  return { "Cache-Control": "private, no-cache" };
}

export default function FrontPage({ loaderData }: Route.ComponentProps) {
  const { template, ...page } = loaderData;
  return <ThemeRenderer bundle={template} page={page} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const site = useSite();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  if (site?.theme.notFound) return <ThemeRenderer bundle={site.theme.notFound} page={null} props={{ status }} />;
  return (
    <main style={{ padding: "6rem 1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>{status === 404 ? "Page not found" : "Something went wrong"}</h1>
      <Link to={site?.lang && site.lang !== site.defaultLang ? `/${site.lang}` : "/"}>Home</Link>
    </main>
  );
}
