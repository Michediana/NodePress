import { desc, eq } from "drizzle-orm";
import { randomToken, sha256 } from "./auth";
import { db, schema } from "./db";

const { apiKeys, users } = schema;

export type ApiScope = "read" | "admin";

export async function listApiKeys() {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scope: apiKeys.scope,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
      createdBy: users.name,
    })
    .from(apiKeys)
    .leftJoin(users, eq(users.id, apiKeys.createdBy))
    .orderBy(desc(apiKeys.createdAt));
}

/** Crea una key e restituisce il valore in chiaro (mostrato una sola volta). */
export async function createApiKey(name: string, scope: ApiScope, userId: number) {
  const prefix = randomToken(6).replace(/[-_]/g, "x").slice(0, 8);
  const key = `np_${prefix}_${randomToken(24)}`;
  await db.insert(apiKeys).values({ name: name.trim(), prefix, keyHash: sha256(key), scope, createdBy: userId });
  return key;
}

export async function deleteApiKey(id: number) {
  await db.delete(apiKeys).where(eq(apiKeys.id, id));
}

export async function findApiKey(key: string) {
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, sha256(key)));
  if (!row) return null;
  // Aggiorna l'ultimo utilizzo al massimo una volta al minuto.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  }
  return row;
}
