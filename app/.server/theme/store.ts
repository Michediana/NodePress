import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { unzipSync, zipSync } from "fflate";
import { db, schema } from "../db";
import type { ThemeBuildError } from "../db/schema";
import { UserError } from "../forms";
import { getSetting, setSettings } from "../settings";
import { buildTheme, normalizeThemePath, parseManifest, type ThemeSources } from "./build";
import { ThemeCompileError } from "./compile";

// Archivio dei temi nel DB: sorgenti, build bozza/pubblicata, storico e asset.
// Ogni salvataggio di un file ricompila il tema: se va a buon fine la bozza punta alla nuova
// build, altrimenti resta sull'ultima valida e l'errore viene salvato sul tema.

const { themes, themeFiles, themeBuilds, themeAssets } = schema;

/** Temi inclusi nel progetto, installati nel DB al primo utilizzo. */
export const STARTER_THEMES_DIR = path.resolve(process.env.THEMES_DIR ?? "themes");

const MAX_PUBLISHED_HISTORY = 20;
const MAX_ZIP_SIZE = 50 * 1024 * 1024;
const MAX_FILES = 1000;

export type ThemeRow = typeof themes.$inferSelect;

export type BuildOutcome = { buildId: number | null; error: ThemeBuildError | null };

function toBuildError(error: unknown): ThemeBuildError {
  if (error instanceof ThemeCompileError) {
    return { message: error.message.replace(/^.*? — /, ""), file: error.file, line: error.line, column: error.column };
  }
  return { message: (error as Error).message, file: null, line: null, column: null };
}

export async function findTheme(name: string) {
  const [row] = await db.select().from(themes).where(eq(themes.name, name));
  return row ?? null;
}

export async function requireTheme(name: string) {
  const row = await findTheme(name);
  if (!row) throw new UserError(`Tema "${name}" non trovato.`, 404);
  return row;
}

export async function listThemes() {
  const [rows, active] = await Promise.all([db.select().from(themes).orderBy(themes.label), getSetting("activeTheme")]);
  return rows.map((row) => ({ ...row, active: row.name === active }));
}

export async function readSources(themeId: number): Promise<ThemeSources> {
  const rows = await db
    .select({ path: themeFiles.path, content: themeFiles.content })
    .from(themeFiles)
    .where(eq(themeFiles.themeId, themeId));
  return new Map(rows.map((r) => [r.path, r.content]));
}

export async function listFiles(themeId: number) {
  return db
    .select({
      path: themeFiles.path,
      size: sql<number>`length(${themeFiles.content})`,
      updatedAt: themeFiles.updatedAt,
    })
    .from(themeFiles)
    .where(eq(themeFiles.themeId, themeId))
    .orderBy(themeFiles.path);
}

export async function readFileContent(themeId: number, file: string) {
  const [row] = await db
    .select({ content: themeFiles.content })
    .from(themeFiles)
    .where(and(eq(themeFiles.themeId, themeId), eq(themeFiles.path, file)));
  return row?.content ?? null;
}

export async function getBuild(id: number) {
  const [row] = await db.select().from(themeBuilds).where(eq(themeBuilds.id, id));
  return row ?? null;
}

/** Ricompila il tema dai sorgenti salvati e aggiorna la bozza. */
export async function rebuild(theme: ThemeRow, userId: number | null): Promise<BuildOutcome> {
  let result: Awaited<ReturnType<typeof buildTheme>>;
  try {
    result = await buildTheme(await readSources(theme.id));
  } catch (error) {
    const buildError = toBuildError(error);
    await db.update(themes).set({ buildError }).where(eq(themes.id, theme.id));
    return { buildId: theme.draftBuildId, error: buildError };
  }

  // Sorgenti identici alla bozza attuale: nessuna nuova build.
  const draft = theme.draftBuildId ? await getBuild(theme.draftBuildId) : null;
  if (draft && draft.data.sourceHash === result.data.sourceHash) {
    await db.update(themes).set({ buildError: null }).where(eq(themes.id, theme.id));
    return { buildId: draft.id, error: null };
  }

  const buildId = await db.transaction(async (tx) => {
    if (result.assets.length) {
      const existing = await tx
        .select({ hash: themeAssets.hash })
        .from(themeAssets)
        .where(
          inArray(
            themeAssets.hash,
            result.assets.map((a) => a.hash),
          ),
        );
      const known = new Set(existing.map((r) => r.hash));
      const fresh = result.assets.filter(
        (a, i, all) => !known.has(a.hash) && all.findIndex((b) => b.hash === a.hash) === i,
      );
      if (fresh.length) await tx.insert(themeAssets).values(fresh);
    }
    const [{ id }] = await tx
      .insert(themeBuilds)
      .values({ themeId: theme.id, data: result.data, createdBy: userId })
      .$returningId();
    await tx.update(themes).set({ draftBuildId: id, buildError: null }).where(eq(themes.id, theme.id));
    return id;
  });
  await prune(theme.id);
  return { buildId, error: null };
}

/** Salva un file del tema e ricompila. */
export async function writeThemeFile(name: string, file: string, content: Buffer, userId: number | null) {
  const theme = await requireTheme(name);
  const clean = safePath(file);
  await db
    .insert(themeFiles)
    .values({ themeId: theme.id, path: clean, content })
    .onDuplicateKeyUpdate({ set: { content, updatedAt: new Date() } });
  return rebuild(theme, userId);
}

export async function deleteThemeFile(name: string, file: string, userId: number | null) {
  const theme = await requireTheme(name);
  const clean = safePath(file);
  if (clean === "theme.json") throw new UserError("theme.json non può essere eliminato.");
  const [res] = await db.delete(themeFiles).where(and(eq(themeFiles.themeId, theme.id), eq(themeFiles.path, clean)));
  if (!res.affectedRows) throw new UserError(`File "${clean}" non trovato.`, 404);
  return rebuild(theme, userId);
}

function safePath(file: string) {
  try {
    return normalizeThemePath(file);
  } catch (error) {
    throw new UserError((error as Error).message);
  }
}

export async function renameThemeFile(name: string, from: string, to: string, userId: number | null) {
  const theme = await requireTheme(name);
  const source = safePath(from);
  const target = safePath(to);
  if (source === "theme.json") throw new UserError("theme.json non può essere rinominato.");
  if (await readFileContent(theme.id, target)) throw new UserError(`Esiste già un file "${target}".`, 409);
  const [res] = await db
    .update(themeFiles)
    .set({ path: target })
    .where(and(eq(themeFiles.themeId, theme.id), eq(themeFiles.path, source)));
  if (!res.affectedRows) throw new UserError(`File "${source}" non trovato.`, 404);
  return rebuild(theme, userId);
}

/** Pubblica la bozza, o una build precedente (rollback). */
export async function publishTheme(name: string, buildId?: number) {
  const theme = await requireTheme(name);
  let target = buildId ?? theme.draftBuildId;
  if (!buildId && theme.buildError) {
    throw new UserError(
      `Il tema ha errori di compilazione (${theme.buildError.file ?? "theme.json"}): correggili prima di pubblicare.`,
    );
  }
  if (!target) throw new UserError("Non c'è nessuna build da pubblicare.");
  const build = await getBuild(target);
  if (!build || build.themeId !== theme.id) throw new UserError("Build non trovata.", 404);
  target = build.id;
  await db.transaction(async (tx) => {
    await tx.update(themeBuilds).set({ publishedAt: new Date() }).where(eq(themeBuilds.id, target));
    await tx.update(themes).set({ publishedBuildId: target }).where(eq(themes.id, theme.id));
  });
  await prune(theme.id);
  return target;
}

export async function listBuilds(themeId: number) {
  return db
    .select({
      id: themeBuilds.id,
      publishedAt: themeBuilds.publishedAt,
      createdAt: themeBuilds.createdAt,
      createdBy: themeBuilds.createdBy,
    })
    .from(themeBuilds)
    .where(eq(themeBuilds.themeId, themeId))
    .orderBy(desc(themeBuilds.id));
}

/**
 * Tiene la bozza, la pubblicata e le ultime build pubblicate (storico per il rollback);
 * poi elimina gli asset non più usati da nessuna build.
 */
async function prune(themeId: number) {
  const [theme] = await db.select().from(themes).where(eq(themes.id, themeId));
  if (!theme) return;
  const keep = [theme.draftBuildId, theme.publishedBuildId].filter((id): id is number => id !== null);
  const history = await db
    .select({ id: themeBuilds.id })
    .from(themeBuilds)
    .where(and(eq(themeBuilds.themeId, themeId), isNotNull(themeBuilds.publishedAt)))
    .orderBy(desc(themeBuilds.publishedAt))
    .limit(MAX_PUBLISHED_HISTORY);
  keep.push(...history.map((h) => h.id));
  await db
    .delete(themeBuilds)
    .where(and(eq(themeBuilds.themeId, themeId), keep.length ? notInArray(themeBuilds.id, keep) : undefined));
  await collectAssets();
}

async function collectAssets() {
  const rows = await db
    .select({ hashes: sql<unknown>`json_extract(${themeBuilds.data}, '$.assetHashes')` })
    .from(themeBuilds);
  const used = new Set<string>();
  for (const row of rows) {
    const list = typeof row.hashes === "string" ? JSON.parse(row.hashes) : row.hashes;
    if (Array.isArray(list)) for (const hash of list) used.add(String(hash));
  }
  await db.delete(themeAssets).where(used.size ? notInArray(themeAssets.hash, [...used]) : undefined);
}

export async function getAsset(hash: string) {
  const [row] = await db.select().from(themeAssets).where(eq(themeAssets.hash, hash));
  return row ?? null;
}

// --- Creazione, attivazione, import/export ---

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Crea un tema dai sorgenti indicati, lo compila e, se richiesto, lo pubblica. */
export async function createTheme(
  input: { name: string; label: string; sources: ThemeSources },
  userId: number | null,
  options: { publish?: boolean } = {},
) {
  if (!NAME_RE.test(input.name)) throw new UserError("Nome del tema non valido: solo minuscole, numeri e trattini.");
  if (await findTheme(input.name)) throw new UserError(`Esiste già un tema "${input.name}".`, 409);
  if (input.sources.size > MAX_FILES) throw new UserError(`Troppi file (massimo ${MAX_FILES}).`);
  const files = [...input.sources].map(([file, content]) => ({ path: safePath(file), content }));
  const [{ id }] = await db.insert(themes).values({ name: input.name, label: input.label }).$returningId();
  // Un file per query: i font e le immagini possono superare max_allowed_packet se inseriti insieme.
  for (const file of files) await db.insert(themeFiles).values({ ...file, themeId: id });
  const outcome = await rebuild((await findTheme(input.name))!, userId);
  if (options.publish && outcome.buildId && !outcome.error) await publishTheme(input.name);
  return outcome;
}

/** Duplica un tema esistente con un nuovo nome. */
export async function duplicateTheme(from: string, name: string, label: string, userId: number | null) {
  const source = await requireTheme(from);
  const sources = await readSources(source.id);
  const manifest = sources.get("theme.json");
  if (manifest) {
    // Il nome nel manifest segue quello del nuovo tema.
    const data = JSON.parse(manifest.toString("utf8"));
    sources.set("theme.json", Buffer.from(JSON.stringify({ ...data, name, label }, null, 2) + "\n"));
  }
  return createTheme({ name, label, sources }, userId);
}

export async function activateTheme(name: string) {
  const theme = await requireTheme(name);
  if (!theme.publishedBuildId) throw new UserError("Pubblica il tema prima di attivarlo.");
  await setSettings({ activeTheme: name });
}

export async function deleteTheme(name: string) {
  const theme = await requireTheme(name);
  if ((await getSetting("activeTheme")) === name) throw new UserError("Il tema attivo non può essere eliminato.");
  await db.delete(themes).where(eq(themes.id, theme.id));
  await collectAssets();
}

export async function exportTheme(name: string) {
  const theme = await requireTheme(name);
  const sources = await readSources(theme.id);
  const entries: Record<string, Uint8Array> = {};
  for (const [file, content] of sources) entries[`${theme.name}/${file}`] = new Uint8Array(content);
  return Buffer.from(zipSync(entries, { level: 6 }));
}

/** Legge uno zip: i file possono stare nella radice o in un'unica cartella (es. `mio-tema/theme.json`). */
export function readZip(buffer: Uint8Array): ThemeSources {
  if (buffer.byteLength > MAX_ZIP_SIZE) throw new UserError("Archivio troppo grande (massimo 50 MB).");
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(buffer, {
      filter: (file) => !file.name.endsWith("/") && !/(^|\/)(__MACOSX|\.)/.test(file.name),
    });
  } catch {
    throw new UserError("Archivio zip non valido.");
  }
  const names = Object.keys(entries);
  if (names.length > MAX_FILES) throw new UserError(`Troppi file (massimo ${MAX_FILES}).`);
  const manifestPath = names.filter((n) => n.endsWith("theme.json")).sort((a, b) => a.length - b.length)[0];
  if (!manifestPath) throw new UserError("Nell'archivio manca theme.json.");
  const prefix = manifestPath.slice(0, -"theme.json".length);
  const sources: ThemeSources = new Map();
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    sources.set(safePath(name.slice(prefix.length)), Buffer.from(entries[name]));
  }
  return sources;
}

export async function importTheme(buffer: Uint8Array, userId: number | null, options: { name?: string } = {}) {
  const sources = readZip(buffer);
  let manifest;
  try {
    manifest = parseManifest(sources.get("theme.json")!.toString("utf8"));
  } catch (error) {
    throw new UserError(`theme.json non valido: ${(error as Error).message}`);
  }
  const name = options.name ?? manifest.name;
  return { name, ...(await createTheme({ name, label: manifest.label, sources }, userId)) };
}

async function readDirSources(dir: string, base = "", out: ThemeSources = new Map()) {
  for (const entry of await readdir(path.join(dir, base), { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await readDirSources(dir, rel, out);
    else out.set(rel, await readFile(path.join(dir, rel)));
  }
  return out;
}

/** Installa un tema incluso nel progetto (`themes/<nome>`), compilato e pubblicato. */
export async function installStarterTheme(name: string) {
  const sources = await readDirSources(path.join(STARTER_THEMES_DIR, name));
  const manifest = parseManifest(sources.get("theme.json")?.toString("utf8") ?? "{}");
  const outcome = await createTheme({ name, label: manifest.label, sources }, null, { publish: true });
  if (outcome.error) throw new Error(`Il tema "${name}" incluso nel progetto non compila: ${outcome.error.message}`);
}

/** Tema attivo pronto all'uso: al primo avvio installa il tema di default dal progetto. */
let installing: Promise<void> | null = null;

export async function ensureActiveTheme() {
  const name = await getSetting("activeTheme");
  const theme = await findTheme(name);
  if (theme?.publishedBuildId) return theme;
  if (!theme) {
    installing ??= installStarterTheme(name).finally(() => (installing = null));
    await installing;
  }
  const installed = await findTheme(name);
  if (!installed?.publishedBuildId) throw new Error(`Il tema attivo "${name}" non ha una build pubblicata.`);
  return installed;
}
