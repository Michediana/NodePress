import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { isTextFile } from "~/lib/theme/files";
import { db, schema } from "../db";
import { UserError } from "../forms";
import { previewUrl } from "../origins";
import { getSetting } from "../settings";
import { previewCookieHeader } from "../theme";
import { lintThemeFile, type ThemeSources } from "../theme/build";
import { scaffoldTheme } from "../theme/scaffold";
import {
  activateTheme,
  createTheme,
  deleteTheme,
  duplicateTheme,
  listBuilds,
  listFiles,
  listThemes,
  publishTheme,
  readFileContent,
  renameThemeFile,
  requireTheme,
  syncThemeFiles,
  type BuildOutcome,
} from "../theme/store";
import { addTool, type McpContext } from "./tools";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const RENDER_TIMEOUT = 20_000;

const themeName = z.string().describe("Nome del tema (minuscole, numeri e trattini), es. default.");

/** Esito di una ricompilazione, con un messaggio esplicito se il tema non compila. */
function buildResult(outcome: BuildOutcome) {
  if (!outcome.error) return { ok: true, draftBuildId: outcome.buildId };
  const { file, line, column, message } = outcome.error;
  return {
    ok: false,
    draftBuildId: outcome.buildId,
    error: outcome.error,
    note: `Il tema non compila (${file ?? "theme.json"}${line ? `:${line}:${column}` : ""}): ${message} I file sono salvati, ma la bozza resta all'ultima build valida.`,
  };
}

async function themeDetail(name: string) {
  const theme = await requireTheme(name);
  const [files, builds, active] = await Promise.all([
    listFiles(theme.id),
    listBuilds(theme.id),
    getSetting("activeTheme"),
  ]);
  return {
    name: theme.name,
    label: theme.label,
    active: active === theme.name,
    draftBuildId: theme.draftBuildId,
    publishedBuildId: theme.publishedBuildId,
    buildError: theme.buildError,
    files: files.map((f) => ({ path: f.path, size: Number(f.size), updatedAt: f.updatedAt })),
    builds: builds.slice(0, 10),
  };
}

/** HTML del body senza script né stili inline, accorciato: quanto basta per controllare il markup. */
function extractBody(html: string, maxChars: number) {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const clean = body
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return clean.length > maxChars
    ? `${clean.slice(0, maxChars)}\n<!-- …troncato (${clean.length} caratteri) -->`
    : clean;
}

export function registerThemeTools(server: McpServer, ctx: McpContext) {
  const siteBase = async () => (await getSetting("siteUrl")).trim().replace(/\/+$/, "") || ctx.origin;

  addTool(
    server,
    "themes_list",
    { title: "Temi", description: "Temi installati, con quello attivo.", readOnly: true },
    async () =>
      (await listThemes()).map((t) => ({
        name: t.name,
        label: t.label,
        active: t.active,
        draftBuildId: t.draftBuildId,
        publishedBuildId: t.publishedBuildId,
        hasBuildError: Boolean(t.buildError),
      })),
  );

  addTool(
    server,
    "theme_get",
    {
      title: "Dettaglio tema",
      description:
        "File del tema, build bozza e pubblicata, storico delle build (per il rollback) ed eventuale errore di compilazione della bozza.",
      readOnly: true,
      input: { name: themeName },
    },
    async ({ name }) => themeDetail(name),
  );

  addTool(
    server,
    "theme_read_files",
    {
      title: "Leggi file del tema",
      description:
        "Contenuto di uno o più file del tema (i file binari, come font e immagini, sono indicati solo con la dimensione).",
      readOnly: true,
      input: { name: themeName, paths: z.array(z.string()).min(1).max(50) },
    },
    async ({ name, paths }) => {
      const theme = await requireTheme(name);
      const files = [];
      for (const file of paths) {
        const content = await readFileContent(theme.id, file);
        if (!content) files.push({ path: file, error: "File non trovato." });
        else if (isTextFile(file)) files.push({ path: file, content: content.toString("utf8") });
        else files.push({ path: file, binary: true, size: content.byteLength });
      }
      return files;
    },
  );

  addTool(
    server,
    "theme_write_files",
    {
      title: "Scrivi file del tema",
      description:
        "Crea, sovrascrive ed elimina file del tema con un'unica ricompilazione della bozza. Il sito pubblico non cambia finché non usi theme_publish. Se il tema non compila i file restano salvati e la risposta riporta file, riga e colonna dell'errore: correggilo e riscrivi. Prima di scrivere un file esistente leggilo, per non perdere modifiche fatte dall'editor visuale.",
      input: {
        name: themeName,
        files: z
          .array(
            z.object({
              path: z.string().describe("Percorso nel tema, es. sections/hero.np o styles/base.css."),
              content: z.string().optional().describe("Contenuto testuale."),
              base64: z.string().optional().describe("Contenuto binario in base64 (font, immagini)."),
            }),
          )
          .default([]),
        delete: z.array(z.string()).default([]).describe("Percorsi da eliminare (theme.json non si può eliminare)."),
      },
    },
    async ({ name, files, delete: remove }) => {
      const write: ThemeSources = new Map();
      for (const file of files) {
        if (file.content === undefined && file.base64 === undefined)
          throw new UserError(`"${file.path}": indica content oppure base64.`);
        const content =
          file.base64 !== undefined ? Buffer.from(file.base64, "base64") : Buffer.from(file.content!, "utf8");
        if (content.byteLength > MAX_FILE_SIZE) throw new UserError(`"${file.path}" è troppo grande (massimo 10 MB).`);
        write.set(file.path, content);
      }
      if (!write.size && !remove.length) throw new UserError("Nessun file da scrivere o eliminare.");
      const outcome = await syncThemeFiles(name, { write, remove }, ctx.user?.id ?? null);
      return { written: [...write.keys()], deleted: remove, ...buildResult(outcome) };
    },
  );

  addTool(
    server,
    "theme_rename_file",
    {
      title: "Rinomina un file del tema",
      description:
        "Rinomina o sposta un file del tema e ricompila la bozza. Aggiorna tu i riferimenti nei file che lo usano.",
      input: { name: themeName, from: z.string(), to: z.string() },
    },
    async ({ name, from, to }) => buildResult(await renameThemeFile(name, from, to, ctx.user?.id ?? null)),
  );

  addTool(
    server,
    "theme_check_file",
    {
      title: "Controlla un file del tema",
      description:
        "Compila un singolo file senza salvarlo e restituisce l'eventuale errore con riga e colonna. Non verifica i riferimenti ad altri file (componenti, asset), che controlla la build completa.",
      readOnly: true,
      input: { path: z.string(), content: z.string() },
    },
    async ({ path, content }) => {
      const error = await lintThemeFile(path, content);
      return error
        ? { ok: false, error: { message: error.message, file: error.file, line: error.line, column: error.column } }
        : { ok: true };
    },
  );

  addTool(
    server,
    "theme_preview",
    {
      title: "Anteprima della bozza",
      description:
        "Rende una pagina del sito con la bozza del tema e restituisce l'HTML del body (senza script e stili), per verificare il risultato. Restituisce anche un link di anteprima da aprire nel browser, valido 30 minuti.",
      readOnly: true,
      input: {
        name: themeName,
        path: z.string().default("/").describe("Percorso della pagina, es. / o /en/news."),
        maxChars: z.number().int().min(1000).max(200_000).default(30_000),
      },
    },
    async ({ name, path, maxChars }) => {
      const theme = await requireTheme(name);
      if (!path.startsWith("/")) throw new UserError('Il percorso deve iniziare con "/".');
      const base = await siteBase();
      const link = await previewUrl(name, path);
      const result: Record<string, unknown> = {
        previewLink: link.startsWith("/") ? base + link : link,
        buildError: theme.buildError,
      };
      try {
        const response = await fetch(base + path, {
          headers: { Cookie: await previewCookieHeader(name), Accept: "text/html" },
          redirect: "manual",
          signal: AbortSignal.timeout(RENDER_TIMEOUT),
        });
        result.status = response.status;
        if (response.headers.get("Location")) result.location = response.headers.get("Location");
        else result.html = extractBody(await response.text(), maxChars);
      } catch (error) {
        result.renderError = `Impossibile rendere la pagina da ${base}: ${(error as Error).message}`;
      }
      return result;
    },
  );

  addTool(
    server,
    "theme_publish",
    {
      title: "Pubblica il tema",
      description:
        "Pubblica la bozza del tema (se è il tema attivo, il sito cambia subito). Con buildId ripubblica una build dello storico: è il rollback. Chiedi conferma all'utente prima di pubblicare il tema attivo.",
      input: { name: themeName, buildId: z.number().int().positive().optional() },
    },
    async ({ name, buildId }) => ({ publishedBuildId: await publishTheme(name, buildId) }),
  );

  addTool(
    server,
    "theme_create",
    {
      title: "Crea un tema",
      description:
        "Crea un tema nuovo da uno scheletro minimo, oppure duplicando un tema esistente (from). Il tema non è attivo e non è pubblicato.",
      input: {
        name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
        label: z.string().trim().min(1).max(255),
        from: z.string().optional().describe("Tema da duplicare."),
      },
    },
    async ({ name, label, from }) => {
      const userId = ctx.user?.id ?? null;
      const outcome = from
        ? await duplicateTheme(from, name, label, userId)
        : await createTheme({ name, label, sources: scaffoldTheme(name, label) }, userId);
      return { name, ...buildResult(outcome) };
    },
  );

  addTool(
    server,
    "theme_update",
    {
      title: "Rinomina un tema",
      description: "Cambia l'etichetta mostrata nel pannello.",
      input: { name: themeName, label: z.string().trim().min(1).max(255) },
    },
    async ({ name, label }) => {
      const theme = await requireTheme(name);
      await db.update(schema.themes).set({ label }).where(eq(schema.themes.id, theme.id));
      return themeDetail(name);
    },
  );

  // Attivare ed eliminare un tema cambiano il sito: solo con key admin.
  if (ctx.scope !== "admin") return;

  addTool(
    server,
    "theme_activate",
    {
      title: "Attiva un tema",
      description:
        "Rende il tema quello del sito pubblico (serve una build pubblicata). Chiedi conferma all'utente prima di usarlo.",
      input: { name: themeName },
    },
    async ({ name }) => {
      await activateTheme(name);
      return { ok: true, activeTheme: name };
    },
  );

  addTool(
    server,
    "theme_delete",
    {
      title: "Elimina un tema",
      description:
        "Elimina un tema non attivo con tutti i file e le build. Chiedi conferma all'utente prima di usarlo.",
      destructive: true,
      input: { name: themeName },
    },
    async ({ name }) => {
      await deleteTheme(name);
      return { ok: true };
    },
  );
}
