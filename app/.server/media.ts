import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, inArray, isNull, like, notLike, sql } from "drizzle-orm";
import sharp from "sharp";
import type { MediaVariant } from "~/lib/media";
import { slugify } from "~/lib/slug";
import { db, schema } from "./db";
import { env } from "./env";
import { UserError } from "./forms";
import { getSettings } from "./settings";

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const VARIANT_SIZES = [640, 1280];
const RASTER_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif", "image/tiff", "image/heic", "image/heif"];
// Formato "tipo/sottotipo" secondo RFC 6838 (eventuali parametri dopo ";" sono ignorati).
const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

/** Percorso assoluto sicuro dentro la cartella media. */
export function resolveMediaPath(file: string) {
  const full = path.resolve(env.mediaDir, file);
  if (!full.startsWith(env.mediaDir + path.sep)) throw new UserError("Percorso non valido.");
  return full;
}

function baseName(originalName: string) {
  const name = slugify(originalName.replace(/\.[^.]+$/, "")) || "file";
  const now = new Date();
  const dir = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${dir}/${name.slice(0, 80)}-${randomBytes(4).toString("hex")}`;
}

async function writeFile(file: string, data: Buffer) {
  const full = resolveMediaPath(file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
}

export async function uploadMedia(file: File, userId: number | null, folderId: number | null = null) {
  if (!file || typeof file === "string" || file.size === 0) throw new UserError("Nessun file caricato.");
  if (file.size > MAX_UPLOAD_BYTES) throw new UserError("Il file supera la dimensione massima di 100 MB.");
  const buffer = Buffer.from(await file.arrayBuffer());
  const base = baseName(file.name);
  const mime = file.type.split(";")[0].trim().toLowerCase();
  if (!MIME_RE.test(mime)) throw new UserError(`Tipo di file non riconosciuto${mime ? `: ${mime}` : "."}`);

  if (RASTER_TYPES.includes(mime)) {
    const { mediaFormat, mediaQuality, mediaMaxSize } = await getSettings(["mediaFormat", "mediaQuality", "mediaMaxSize"]);
    const variants: MediaVariant[] = [];
    const sizes = [...VARIANT_SIZES.filter((s) => s < mediaMaxSize), mediaMaxSize];
    let main: MediaVariant | null = null;
    for (const size of sizes) {
      const isMain = size === mediaMaxSize;
      const pipeline = sharp(buffer, { animated: mime === "image/gif" })
        .rotate()
        .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true });
      const output = await (mediaFormat === "avif" ? pipeline.avif({ quality: mediaQuality }) : pipeline.webp({ quality: mediaQuality }))
        .toBuffer({ resolveWithObject: true });
      // Le varianti più grandi dell'immagine risultante sono inutili.
      if (!isMain && Math.max(output.info.width, output.info.height) < size) continue;
      const name = `${base}${isMain ? "" : `-${size}`}.${mediaFormat}`;
      await writeFile(name, output.data);
      const variant = { width: output.info.width, height: output.info.height, file: name, size: output.data.length };
      variants.push(variant);
      if (isMain) main = variant;
    }
    const [result] = await db.insert(schema.media).values({
      folderId,
      file: main!.file,
      originalName: file.name.slice(0, 255),
      mime: `image/${mediaFormat}`,
      size: main!.size,
      width: main!.width,
      height: main!.height,
      variants,
      alt: {},
      uploadedBy: userId,
    });
    return result.insertId;
  }

  const ext = path.extname(file.name).toLowerCase().replace(/[^.a-z0-9]/g, "") || "";
  const name = `${base}${ext}`;
  await writeFile(name, buffer);
  const [result] = await db.insert(schema.media).values({
    folderId,
    file: name,
    originalName: file.name.slice(0, 255),
    mime,
    size: buffer.length,
    variants: [],
    alt: {},
    uploadedBy: userId,
  });
  return result.insertId;
}

/**
 * Elenco paginato dei media. `folderId` limita alla cartella indicata (`null` = radice);
 * se omesso cerca in tutta la libreria.
 */
export async function listMedia(options: { page: number; perPage: number; q?: string; type?: string; folderId?: number | null }) {
  const { media } = schema;
  const conditions = [];
  if (options.folderId !== undefined) {
    conditions.push(options.folderId === null ? isNull(media.folderId) : eq(media.folderId, options.folderId));
  }
  if (options.q) conditions.push(like(media.originalName, `%${options.q}%`));
  if (options.type === "image") conditions.push(like(media.mime, "image/%"));
  if (options.type === "video") conditions.push(like(media.mime, "video/%"));
  if (options.type === "document") conditions.push(and(notLike(media.mime, "image/%"), notLike(media.mime, "video/%")));
  const where = conditions.length ? sql.join(conditions, sql` and `) : undefined;
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(media).where(where);
  const items = await db
    .select()
    .from(media)
    .where(where)
    .orderBy(desc(media.createdAt), desc(media.id))
    .limit(options.perPage)
    .offset((options.page - 1) * options.perPage);
  return { total: Number(total), items };
}

export async function getMedia(id: number) {
  const [row] = await db.select().from(schema.media).where(eq(schema.media.id, id));
  return row ?? null;
}

export async function updateMediaAlt(id: number, alt: Record<string, string>) {
  await db.update(schema.media).set({ alt }).where(eq(schema.media.id, id));
}

export async function deleteMedia(id: number) {
  const row = await getMedia(id);
  if (!row) return;
  await db.delete(schema.media).where(eq(schema.media.id, id));
  const files = new Set([row.file, ...row.variants.map((v) => v.file)]);
  for (const file of files) {
    await fs.rm(resolveMediaPath(file), { force: true });
  }
}

export async function getMediaMany(ids: number[]) {
  if (!ids.length) return [];
  return db.select().from(schema.media).where(inArray(schema.media.id, ids));
}

export async function renameMedia(id: number, name: string) {
  const clean = name.trim().slice(0, 255);
  if (!clean) throw new UserError("Il nome non può essere vuoto.");
  await db.update(schema.media).set({ originalName: clean }).where(eq(schema.media.id, id));
}

export async function moveMedia(ids: number[], folderId: number | null) {
  if (!ids.length) return;
  if (folderId !== null && !(await getFolder(folderId))) throw new UserError("Cartella di destinazione inesistente.");
  await db.update(schema.media).set({ folderId }).where(inArray(schema.media.id, ids));
}

// --- Cartelle ---

export async function listFolders() {
  return db.select().from(schema.mediaFolders).orderBy(asc(schema.mediaFolders.name));
}

export async function getFolder(id: number) {
  const [row] = await db.select().from(schema.mediaFolders).where(eq(schema.mediaFolders.id, id));
  return row ?? null;
}

/** Id della cartella e di tutte le sue discendenti. */
export function descendantFolderIds(folders: { id: number; parentId: number | null }[], rootId: number) {
  const ids = new Set([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const f of folders) {
      if (f.parentId !== null && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        added = true;
      }
    }
  }
  return [...ids];
}

function cleanFolderName(name: string) {
  const clean = name.replace(/\//g, "-").trim().slice(0, 255);
  if (!clean) throw new UserError("Il nome della cartella non può essere vuoto.");
  return clean;
}

async function assertUniqueFolderName(name: string, parentId: number | null, exceptId?: number) {
  const { mediaFolders } = schema;
  const siblings = await db
    .select({ id: mediaFolders.id, name: mediaFolders.name })
    .from(mediaFolders)
    .where(parentId === null ? isNull(mediaFolders.parentId) : eq(mediaFolders.parentId, parentId));
  if (siblings.some((f) => f.id !== exceptId && f.name.toLowerCase() === name.toLowerCase())) {
    throw new UserError(`Esiste già una cartella "${name}" in questa posizione.`);
  }
}

export async function createFolder(name: string, parentId: number | null, userId: number | null) {
  const clean = cleanFolderName(name);
  if (parentId !== null && !(await getFolder(parentId))) throw new UserError("Cartella superiore inesistente.");
  await assertUniqueFolderName(clean, parentId);
  const [result] = await db.insert(schema.mediaFolders).values({ name: clean, parentId, createdBy: userId });
  return result.insertId;
}

export async function renameFolder(id: number, name: string) {
  const folder = await getFolder(id);
  if (!folder) throw new UserError("Cartella inesistente.", 404);
  const clean = cleanFolderName(name);
  await assertUniqueFolderName(clean, folder.parentId, id);
  await db.update(schema.mediaFolders).set({ name: clean }).where(eq(schema.mediaFolders.id, id));
}

export async function moveFolders(ids: number[], parentId: number | null) {
  if (!ids.length) return;
  const folders = await listFolders();
  if (parentId !== null && !folders.some((f) => f.id === parentId)) throw new UserError("Cartella di destinazione inesistente.");
  for (const id of ids) {
    const folder = folders.find((f) => f.id === id);
    if (!folder) continue;
    if (parentId !== null && descendantFolderIds(folders, id).includes(parentId)) {
      throw new UserError(`Impossibile spostare "${folder.name}" dentro se stessa.`);
    }
    if (folder.parentId === parentId) continue;
    await assertUniqueFolderName(folder.name, parentId, id);
    await db.update(schema.mediaFolders).set({ parentId }).where(eq(schema.mediaFolders.id, id));
    folder.parentId = parentId;
  }
}

/** Media contenuti (anche in sottocartelle) nelle cartelle indicate. */
export async function mediaInFolders(ids: number[]) {
  if (!ids.length) return [];
  const folders = await listFolders();
  const all = [...new Set(ids.flatMap((id) => descendantFolderIds(folders, id)))];
  return db
    .select({ id: schema.media.id, uploadedBy: schema.media.uploadedBy })
    .from(schema.media)
    .where(inArray(schema.media.folderId, all));
}

/** Elimina le cartelle con tutte le sottocartelle e i file contenuti. */
export async function deleteFolders(ids: number[]) {
  for (const item of await mediaInFolders(ids)) await deleteMedia(item.id);
  if (ids.length) await db.delete(schema.mediaFolders).where(inArray(schema.mediaFolders.id, ids));
}

/** Numero di file direttamente contenuti in ogni cartella (chiave "root" per la radice). */
export async function mediaCountsByFolder() {
  const rows = await db
    .select({ folderId: schema.media.folderId, count: sql<number>`count(*)` })
    .from(schema.media)
    .groupBy(schema.media.folderId);
  return Object.fromEntries(rows.map((r) => [r.folderId ?? "root", Number(r.count)])) as Record<string, number>;
}
