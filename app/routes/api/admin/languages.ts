import { z } from "zod";
import { ApiError, authenticate, handle, methodNotAllowed, readJson } from "~/.server/api";
import { addLanguage, getLanguages, removeLanguage, setDefaultLanguage } from "~/.server/languages";
import { normalizeLangCode } from "~/lib/languages";
import type { Route } from "./+types/languages";

export const loader = ({ request }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "admin");
    return { items: await getLanguages() };
  });

// POST {code} attiva, PATCH {default} imposta la default, DELETE ?code= disattiva.
export const action = ({ request }: Route.ActionArgs) =>
  handle(request, async () => {
    await authenticate(request, "admin");
    if (request.method === "POST") {
      const { code } = await readJson(request, z.object({ code: z.string() }));
      const normalized = normalizeLangCode(code);
      if (!normalized) throw new ApiError(400, "Codice lingua non valido.");
      await addLanguage(normalized);
    } else if (request.method === "PATCH") {
      const input = await readJson(request, z.object({ default: z.string() }));
      await setDefaultLanguage(input.default);
    } else if (request.method === "DELETE") {
      const code = new URL(request.url).searchParams.get("code");
      if (!code) throw new ApiError(400, 'Parametro "code" mancante.');
      await removeLanguage(code).catch((e: Error) => {
        throw new ApiError(400, e.message);
      });
    } else {
      methodNotAllowed();
    }
    return { items: await getLanguages() };
  });
