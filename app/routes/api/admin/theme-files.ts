import path from "node:path";
import { ApiError, authenticate, handle, methodNotAllowed } from "~/.server/api";
import { THEME_FILE_TYPES, isTextFile } from "~/.server/theme/build";
import { deleteThemeFile, listFiles, readFileContent, requireTheme, writeThemeFile } from "~/.server/theme/store";
import type { Route } from "./+types/theme-files";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

// GET /themes/:name/files → elenco; GET|PUT|DELETE /themes/:name/files/<percorso> → singolo file.
// Il contenuto viaggia così com'è nel body (testo o binario), senza JSON.

export const loader = ({ request, params }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "admin");
    const theme = await requireTheme(params.name);
    const file = params["*"] ?? "";
    if (!file) return { items: await listFiles(theme.id) };
    const content = await readFileContent(theme.id, file);
    if (!content) throw new ApiError(404, `File "${file}" non trovato.`);
    const type = THEME_FILE_TYPES[path.posix.extname(file).toLowerCase()] ?? "application/octet-stream";
    return new Response(new Uint8Array(content), {
      headers: { "Content-Type": isTextFile(file) ? `${type}; charset=utf-8` : type, "Cache-Control": "no-store" },
    });
  });

export const action = ({ request, params }: Route.ActionArgs) =>
  handle(request, async () => {
    const { user } = await authenticate(request, "admin");
    const file = params["*"] ?? "";
    if (!file) throw new ApiError(400, "Percorso del file mancante.");
    if (request.method === "DELETE")
      return { path: file, ...(await deleteThemeFile(params.name, file, user?.id ?? null)) };
    if (request.method !== "PUT") methodNotAllowed();
    const content = Buffer.from(await request.arrayBuffer());
    if (content.byteLength > MAX_FILE_SIZE) throw new ApiError(413, "File troppo grande (massimo 10 MB).");
    // Il file viene salvato anche se il tema non compila: l'errore torna nella risposta.
    return { path: file, ...(await writeThemeFile(params.name, file, content, user?.id ?? null)) };
  });
