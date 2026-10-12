import { getRobotsTxt } from "~/.server/seo-files";
import { getSiteUrl } from "~/.server/settings";
import type { Route } from "./+types/robots";

export async function loader({ request }: Route.LoaderArgs) {
  return new Response(await getRobotsTxt(await getSiteUrl(request)), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
