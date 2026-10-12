import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { desc, eq, like, or, sql } from "drizzle-orm";
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
const PASSTHROUGH_TYPES = [/^image\/svg\+xml$/, /^application\/pdf$/, /^video\//, /^audio\//];

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

export async function uploadMedia(file: File, userId: number | null) {
  if (!file || typeof file === "string" || file.size === 0) throw new UserError("Nessun file caricato.");
  if (file.size > MAX_UPLOAD_BYTES) throw new UserError("Il file supera la dimensione massima di 100 MB.");
  const buffer = Buffer.from(await file.arrayBuffer());
  const base = baseName(file.name);
  const mime = file.type || "application/octet-stream";

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

  if (!PASSTHROUGH_TYPES.some((re) => re.test(mime))) {
    throw new UserError(`Tipo di file non supportato: ${mime}`);
  }
  const ext = path.extname(file.name).toLowerCase().replace(/[^.a-z0-9]/g, "") || "";
  const name = `${base}${ext}`;
  await writeFile(name, buffer);
  const [result] = await db.insert(schema.media).values({
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

export async function listMedia(options: { page: number; perPage: number; q?: string; type?: string }) {
  const { media } = schema;
  const conditions = [];
  if (options.q) conditions.push(like(media.originalName, `%${options.q}%`));
  if (options.type === "image") conditions.push(like(media.mime, "image/%"));
  if (options.type === "video") conditions.push(like(media.mime, "video/%"));
  if (options.type === "document") conditions.push(or(like(media.mime, "application/%"), like(media.mime, "audio/%")));
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
