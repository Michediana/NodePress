import path from "node:path";
import { ApiError, authenticate, handle, methodNotAllowed } from "~/.server/api";
import { THEME_FILE_TYPES, isTextFile, type ThemeSources } from "~/.server/theme/build";
import {
  deleteThemeFile,
  listFiles,
  readFileContent,
  requireTheme,
  syncThemeFiles,
  writeThemeFile,
} from "~/.server/theme/store";
import type { Route } from "./+types/theme-files";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

// GET /themes/:name/files → elenco (con ?hash anche lo SHA-256 di ogni file);
// POST /themes/:name/files → più file in un colpo solo, con una sola ricompilazione:
//   multipart in cui ogni campo file ha come nome il percorso, e i campi "delete" i percorsi da eliminare;
// GET|PUT|DELETE /themes/:name/files/<percorso> → singolo file.
// Il contenuto viaggia così com'è nel body (testo o binario), senza JSON.

export const loader = ({ request, params }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "theme");
    const theme = await requireTheme(params.name);
    const file = params["*"] ?? "";
    if (!file) return { items: await listFiles(theme.id, { hash: new URL(request.url).searchParams.has("hash") }) };
    const content = await readFileContent(theme.id, file);
    if (!content) throw new ApiError(404, `File "${file}" non trovato.`);
    const type = THEME_FILE_TYPES[path.posix.extname(file).toLowerCase()] ?? "application/octet-stream";
    return new Response(new Uint8Array(content), {
      headers: { "Content-Type": isTextFile(file) ? `${type}; charset=utf-8` : type, "Cache-Control": "no-store" },
    });
  });

export const action = ({ request, params }: Route.ActionArgs) =>
  handle(request, async () => {
    const { user } = await authenticate(request, "theme");
    const file = params["*"] ?? "";
    if (!file) {
      if (request.method !== "POST") throw new ApiError(400, "Percorso del file mancante.");
      return syncFiles(request, params.name, user?.id ?? null);
    }
    if (request.method === "DELETE")
      return { path: file, ...(await deleteThemeFile(params.name, file, user?.id ?? null)) };
    if (request.method !== "PUT") methodNotAllowed();
    const content = Buffer.from(await request.arrayBuffer());
    if (content.byteLength > MAX_FILE_SIZE) throw new ApiError(413, "File troppo grande (massimo 10 MB).");
    // Il file viene salvato anche se il tema non compila: l'errore torna nella risposta.
    return { path: file, ...(await writeThemeFile(params.name, file, content, user?.id ?? null)) };
  });

async function syncFiles(request: Request, name: string, userId: number | null) {
  if (!request.headers.get("Content-Type")?.startsWith("multipart/form-data"))
    throw new ApiError(415, "Serve un body multipart/form-data.");
  const form = await request.formData().catch(() => {
    throw new ApiError(400, "Body multipart non valido.");
  });
  const write: ThemeSources = new Map();
  const remove: string[] = [];
  for (const [field, value] of form) {
    if (field === "delete") {
      if (typeof value === "string") remove.push(value);
      continue;
    }
    if (!(value instanceof File)) continue;
    if (value.size > MAX_FILE_SIZE) throw new ApiError(413, `"${field}" è troppo grande (massimo 10 MB).`);
    write.set(field, Buffer.from(await value.arrayBuffer()));
  }
  if (!write.size && !remove.length) throw new ApiError(400, "Nessun file da scrivere o eliminare.");
  return { written: [...write.keys()], deleted: remove, ...(await syncThemeFiles(name, { write, remove }, userId)) };
}
