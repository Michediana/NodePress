import { z } from "zod";
import { authenticate, handle, intParam, methodNotAllowed, readJson } from "~/.server/api";
import { deleteRedirect, updateRedirect } from "~/.server/redirects";
import type { Route } from "./+types/redirect";

export const loader = ({ request }: Route.LoaderArgs) => handle(request, async () => methodNotAllowed());

export const action = ({ request, params }: Route.ActionArgs) =>
  handle(request, async () => {
    await authenticate(request, "admin");
    const id = intParam(params.id);
    if (request.method === "DELETE") {
      await deleteRedirect(id);
      return { ok: true };
    }
    if (request.method !== "PATCH") methodNotAllowed();
    await updateRedirect(id, await readJson(request, z.object({ toPath: z.string().min(1).max(1000), statusCode: z.number().int().default(301) })));
    return { ok: true };
  });
