import { z } from "zod";
import { ApiError, authenticate, handle, json, methodNotAllowed, readJson } from "~/.server/api";
import { scaffoldTheme } from "~/.server/theme/scaffold";
import { createTheme, duplicateTheme, importTheme, listThemes } from "~/.server/theme/store";
import type { Route } from "./+types/themes";

const createSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  label: z.string().trim().min(1).max(255),
  /** Tema da duplicare; se assente si parte da uno scheletro minimo. */
  from: z.string().optional(),
});

export const loader = ({ request }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "theme");
    return { items: await listThemes() };
  });

// POST JSON: crea o duplica un tema. POST multipart (campo "file"): importa uno zip.
export const action = ({ request }: Route.ActionArgs) =>
  handle(request, async () => {
    if (request.method !== "POST") methodNotAllowed();
    const { user } = await authenticate(request, "theme");
    const userId = user?.id ?? null;
    if (request.headers.get("Content-Type")?.startsWith("multipart/form-data")) {
      const form = await request.formData().catch(() => {
        throw new ApiError(400, "Body multipart non valido.");
      });
      const file = form.get("file");
      if (!(file instanceof File)) throw new ApiError(400, 'Nessun file nel campo "file".');
      const name = form.get("name");
      const result = await importTheme(new Uint8Array(await file.arrayBuffer()), userId, {
        name: typeof name === "string" && name ? name : undefined,
      });
      return json(result, 201);
    }
    const input = await readJson(request, createSchema);
    const outcome = input.from
      ? await duplicateTheme(input.from, input.name, input.label, userId)
      : await createTheme(
          { name: input.name, label: input.label, sources: scaffoldTheme(input.name, input.label) },
          userId,
        );
    return json({ name: input.name, ...outcome }, 201);
  });
