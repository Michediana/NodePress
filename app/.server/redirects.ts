import { desc, eq, like, or, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { UserError } from "./forms";

const { redirects } = schema;

export function normalizeFromPath(value: string) {
  let path = value.trim();
  try {
    if (/^https?:\/\//.test(path)) path = new URL(path).pathname;
  } catch {}
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path;
}

export async function listRedirects(options: { page: number; perPage: number; q?: string }) {
  const where = options.q ? or(like(redirects.fromPath, `%${options.q}%`), like(redirects.toPath, `%${options.q}%`)) : undefined;
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(redirects).where(where);
  const items = await db
    .select()
    .from(redirects)
    .where(where)
    .orderBy(desc(redirects.createdAt), desc(redirects.id))
    .limit(options.perPage)
    .offset((options.page - 1) * options.perPage);
  return { total: Number(total), items };
}

export async function createRedirect(input: { fromPath: string; toPath: string; statusCode: number }) {
  const fromPath = normalizeFromPath(input.fromPath);
  const toPath = input.toPath.trim();
  if (!toPath) throw new UserError("Indica la destinazione.");
  if (fromPath === toPath) throw new UserError("Origine e destinazione coincidono.");
  if (![301, 302, 307, 308].includes(input.statusCode)) throw new UserError("Codice non valido.");
  const [existing] = await db.select().from(redirects).where(eq(redirects.fromPath, fromPath));
  if (existing) throw new UserError(`Esiste già un redirect da ${fromPath}.`);
  const [result] = await db.insert(redirects).values({ fromPath, toPath, statusCode: input.statusCode, automatic: false });
  return result.insertId;
}

export async function updateRedirect(id: number, input: { toPath: string; statusCode: number }) {
  await db.update(redirects).set({ toPath: input.toPath.trim(), statusCode: input.statusCode }).where(eq(redirects.id, id));
}

export async function deleteRedirect(id: number) {
  await db.delete(redirects).where(eq(redirects.id, id));
}

export async function findRedirect(path: string) {
  const [row] = await db.select().from(redirects).where(eq(redirects.fromPath, normalizeFromPath(path)));
  return row ?? null;
}
