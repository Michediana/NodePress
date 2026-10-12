import { ApiError, authenticate, handle, json, methodNotAllowed } from "~/.server/api";
import { pagination } from "~/.server/api-public";
import { getMedia, listMedia, uploadMedia } from "~/.server/media";
import type { Route } from "./+types/media";

export const loader = ({ request }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "admin");
    const url = new URL(request.url);
    const { page, perPage } = pagination(url);
    return { page, perPage, ...(await listMedia({ page, perPage, q: url.searchParams.get("q") ?? "", type: url.searchParams.get("type") ?? "" })) };
  });

// Upload multipart: campo "file" (anche ripetuto).
export const action = ({ request }: Route.ActionArgs) =>
  handle(request, async () => {
    if (request.method !== "POST") methodNotAllowed();
    const { user } = await authenticate(request, "admin");
    const form = await request.formData().catch(() => {
      throw new ApiError(400, "Body multipart non valido.");
    });
    const files = [...form.getAll("file"), ...form.getAll("files")].filter((f): f is File => typeof f !== "string");
    if (!files.length) throw new ApiError(400, 'Nessun file nel campo "file".');
    const items = [];
    for (const file of files) items.push(await getMedia(await uploadMedia(file, user?.id ?? null)));
    return json({ items }, 201);
  });
