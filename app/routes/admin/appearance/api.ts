import path from "node:path";
import { z } from "zod";
import { requirePermission } from "~/.server/auth";
import { UserError } from "~/.server/forms";
import { isTextFile, lintThemeFile, THEME_FILE_TYPES } from "~/.server/theme/build";
import {
  deleteThemeFile,
  exportTheme,
  publishTheme,
  readFileContent,
  renameThemeFile,
  requireTheme,
  writeThemeFile,
} from "~/.server/theme/store";
import type { Route } from "./+types/api";

// Endpoint dell'editor dei temi, con la sessione del pannello (le API REST usano le API key).
// GET ?path=… legge un file, GET ?export scarica lo zip; POST esegue le operazioni sui file.

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function loader({ request, params, context }: Route.LoaderArgs) {
  requirePermission(context, "themes");
  const theme = await requireTheme(params.name);
  const url = new URL(request.url);
  if (url.searchParams.has("export")) {
    return new Response(new Uint8Array(await exportTheme(theme.name)), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${theme.name}.zip"` },
    });
  }
  const file = url.searchParams.get("path") ?? "";
  const content = file ? await readFileContent(theme.id, file) : null;
  if (!content) throw new Response("File non trovato.", { status: 404 });
  const type = THEME_FILE_TYPES[path.posix.extname(file).toLowerCase()] ?? "application/octet-stream";
  return new Response(new Uint8Array(content), {
    headers: { "Content-Type": isTextFile(file) ? `${type}; charset=utf-8` : type, "Cache-Control": "no-store" },
  });
}

const actionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("save"), path: z.string(), content: z.string() }),
  z.object({ intent: z.literal("lint"), path: z.string(), content: z.string() }),
  z.object({ intent: z.literal("delete"), path: z.string() }),
  z.object({ intent: z.literal("rename"), from: z.string(), to: z.string() }),
  z.object({ intent: z.literal("publish"), buildId: z.number().int().positive().optional() }),
]);

export async function action({ request, params, context }: Route.ActionArgs) {
  const user = requirePermission(context, "themes");
  try {
    // Upload di un file binario (asset): multipart con "path" e "file".
    if (request.headers.get("Content-Type")?.startsWith("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      const target = form.get("path");
      if (!(file instanceof File) || typeof target !== "string") throw new UserError("File mancante.");
      if (file.size > MAX_FILE_SIZE) throw new UserError("File troppo grande (massimo 10 MB).");
      const outcome = await writeThemeFile(params.name, target, Buffer.from(await file.arrayBuffer()), user.id);
      return Response.json({ ok: true, path: target, ...outcome });
    }

    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new UserError("Richiesta non valida.");
    const input = parsed.data;
    switch (input.intent) {
      case "lint": {
        const error = await lintThemeFile(input.path, input.content);
        return Response.json({
          ok: true,
          error: error && {
            message: error.message.replace(/^.*? — /, ""),
            file: error.file,
            line: error.line,
            column: error.column,
          },
        });
      }
      case "save":
        if (!isTextFile(input.path)) throw new UserError("Questo tipo di file si carica, non si modifica come testo.");
        return Response.json({
          ok: true,
          path: input.path,
          ...(await writeThemeFile(params.name, input.path, Buffer.from(input.content), user.id)),
        });
      case "delete":
        return Response.json({ ok: true, ...(await deleteThemeFile(params.name, input.path, user.id)) });
      case "rename":
        return Response.json({ ok: true, ...(await renameThemeFile(params.name, input.from, input.to, user.id)) });
      case "publish":
        return Response.json({ ok: true, publishedBuildId: await publishTheme(params.name, input.buildId) });
    }
  } catch (error) {
    if (error instanceof UserError)
      return Response.json({ ok: false, message: error.message }, { status: error.status });
    throw error;
  }
}
