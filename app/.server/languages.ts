import { asc, eq, sql } from "drizzle-orm";
import type { SiteLanguages } from "~/lib/languages";
import { db, schema } from "./db";

export async function getLanguages() {
  return db
    .select()
    .from(schema.languages)
    .orderBy(sql`${schema.languages.isDefault} desc`, asc(schema.languages.sortOrder), asc(schema.languages.code));
}

export async function getSiteLanguages(): Promise<SiteLanguages> {
  const rows = await getLanguages();
  const def = rows.find((r) => r.isDefault) ?? rows[0];
  return { codes: rows.map((r) => r.code), defaultLang: def?.code ?? "it" };
}

export async function addLanguage(code: string) {
  const rows = await getLanguages();
  if (rows.some((r) => r.code === code)) return;
  await db.insert(schema.languages).values({
    code,
    isDefault: rows.length === 0,
    sortOrder: rows.length,
  });
}

export async function removeLanguage(code: string) {
  const [row] = await db.select().from(schema.languages).where(eq(schema.languages.code, code));
  if (!row) return;
  if (row.isDefault) throw new Error("La lingua di default non si può disattivare.");
  await db.delete(schema.languages).where(eq(schema.languages.code, code));
}

export async function setDefaultLanguage(code: string) {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.languages).where(eq(schema.languages.code, code));
    if (!row) throw new Error("Lingua non attiva.");
    await tx.update(schema.languages).set({ isDefault: false });
    await tx.update(schema.languages).set({ isDefault: true }).where(eq(schema.languages.code, code));
  });
}
