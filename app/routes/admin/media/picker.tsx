import { requirePermission } from "~/.server/auth";
import { listMedia } from "~/.server/media";
import type { Route } from "./+types/picker";

// Endpoint JSON usato dal selettore media dell'editor.
export async function loader({ request, context }: Route.LoaderArgs) {
  requirePermission(context, "media.upload");
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const result = await listMedia({
    page,
    perPage: 30,
    q: url.searchParams.get("q") ?? "",
    type: url.searchParams.get("type") ?? "",
  });
  return { ...result, page, perPage: 30 };
}
