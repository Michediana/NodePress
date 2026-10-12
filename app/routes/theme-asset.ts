import { getAsset } from "~/.server/theme/store";
import type { Route } from "./+types/theme-asset";

/** Asset compilati e statici dei temi, indirizzati per hash: il contenuto non cambia mai. */
export async function loader({ params }: Route.LoaderArgs) {
  const match = /^([0-9a-f]{24})\.[a-z0-9]+$/.exec(params.file);
  const asset = match ? await getAsset(match[1]) : null;
  if (!asset) throw new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(asset.content), {
    headers: {
      "Content-Type": asset.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
