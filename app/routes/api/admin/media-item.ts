import { z } from "zod";
import { ApiError, authenticate, handle, intParam, methodNotAllowed, readJson } from "~/.server/api";
import { deleteMedia, getMedia, updateMediaAlt } from "~/.server/media";
import type { Route } from "./+types/media-item";

async function find(id: string | undefined) {
  const media = await getMedia(intParam(id));
  if (!media) throw new ApiError(404, "Media non trovato.");
  return media;
}

export const loader = ({ request, params }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "admin");
    return find(params.id);
  });

export const action = ({ request, params }: Route.ActionArgs) =>
  handle(request, async () => {
    await authenticate(request, "admin");
    const media = await find(params.id);
    if (request.method === "DELETE") {
      await deleteMedia(media.id);
      return { ok: true };
    }
    if (request.method !== "PATCH") methodNotAllowed();
    const input = await readJson(request, z.object({ alt: z.record(z.string(), z.string().max(500)) }));
    await updateMediaAlt(media.id, { ...media.alt, ...input.alt });
    return find(params.id);
  });
