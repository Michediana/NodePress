import { getLlmsTxt } from "~/.server/seo-files";
import { getSiteUrl } from "~/.server/settings";
import type { Route } from "./+types/llms";

export async function loader({ request }: Route.LoaderArgs) {
  return new Response(await getLlmsTxt(await getSiteUrl(request)), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
