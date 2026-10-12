import { buildSitemap } from "~/.server/seo-files";
import { getSiteUrl } from "~/.server/settings";
import type { Route } from "./+types/sitemap";

export async function loader({ request }: Route.LoaderArgs) {
  const xml = await buildSitemap(await getSiteUrl(request));
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
