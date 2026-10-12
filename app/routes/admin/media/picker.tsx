import { requirePermission } from "~/.server/auth";
import { listFolders, listMedia } from "~/.server/media";
import type { Route } from "./+types/picker";

// Endpoint JSON usato dal selettore media dell'editor.
export async function loader({ request, context }: Route.LoaderArgs) {
  requirePermission(context, "media.upload");
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const folderParam = Number(url.searchParams.get("folder"));
  const folders = await listFolders();
  const folderId = folders.some((f) => f.id === folderParam) ? folderParam : null;
  const result = await listMedia({
    page,
    perPage: 30,
    q: url.searchParams.get("q") ?? "",
    type: url.searchParams.get("type") ?? "",
    folderId,
  });
  return { ...result, page, perPage: 30, folderId, folders: folders.map(({ id, name, parentId }) => ({ id, name, parentId })) };
}
