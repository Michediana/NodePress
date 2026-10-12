import { ApiError, authenticate, handle, intParam, methodNotAllowed, readJson } from "~/.server/api";
import { adminNode, translationSchema } from "~/.server/api-admin";
import { deleteTranslation, saveTranslation } from "~/.server/nodes";
import type { Route } from "./+types/translation";

export const loader = ({ request, params }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "admin");
    const node = await adminNode(intParam(params.id));
    const translation = node.translations.find((t) => t.lang === params.lang);
    if (!translation) throw new ApiError(404, "Traduzione non trovata.");
    return translation;
  });

export const action = ({ request, params }: Route.ActionArgs) =>
  handle(request, async () => {
    await authenticate(request, "admin");
    const id = intParam(params.id);
    const node = await adminNode(id);
    if (request.method === "DELETE") {
      if (!node.translations.some((t) => t.lang === params.lang)) throw new ApiError(404, "Traduzione non trovata.");
      await deleteTranslation(id, params.lang);
      return { ok: true };
    }
    if (request.method !== "PUT") methodNotAllowed();
    await saveTranslation(id, params.lang, await readJson(request, translationSchema));
    return (await adminNode(id)).translations.find((t) => t.lang === params.lang);
  });
