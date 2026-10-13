import { and, asc, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { hashPassword } from "./auth";
import { db, schema } from "./db";
import { UserError } from "./forms";

const { users } = schema;

export const userColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  themeDeveloper: users.themeDeveloper,
  createdAt: users.createdAt,
};

export const userInputSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.email().trim().toLowerCase(),
  role: z.enum(["admin", "editor", "author"]),
  password: z.union([z.literal(""), z.string().min(8).max(200)]).optional(),
  /** Capability "Sviluppatore tema" (dal form arriva "on"); per gli admin è implicita. */
  themeDeveloper: z.union([z.boolean(), z.literal("on").transform(() => true)]).optional(),
});

export type UserInput = z.infer<typeof userInputSchema>;

export async function listUsers() {
  return db.select(userColumns).from(users).orderBy(asc(users.name));
}

export async function getUserById(id: number) {
  const [row] = await db.select(userColumns).from(users).where(eq(users.id, id));
  return row ?? null;
}

async function assertEmailFree(email: string, exceptId?: number) {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(exceptId ? and(eq(users.email, email), ne(users.id, exceptId)) : eq(users.email, email));
  if (row) throw new UserError("Esiste già un utente con questa email.", 400, { email: "Email già in uso." });
}

async function adminCount(exceptId: number) {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), ne(users.id, exceptId)));
  return row.n;
}

export async function createUser(input: UserInput) {
  if (!input.password) throw new UserError("La password è obbligatoria.", 400, { password: "Obbligatoria." });
  await assertEmailFree(input.email);
  const [result] = await db.insert(users).values({
    name: input.name,
    email: input.email,
    role: input.role,
    themeDeveloper: Boolean(input.themeDeveloper),
    passwordHash: await hashPassword(input.password),
  });
  return result.insertId;
}

export async function updateUser(id: number, input: UserInput) {
  await assertEmailFree(input.email, id);
  const current = await getUserById(id);
  if (!current) throw new UserError("Utente non trovato.", 404);
  if (current.role === "admin" && input.role !== "admin" && (await adminCount(id)) === 0) {
    throw new UserError("Deve restare almeno un amministratore.");
  }
  await db
    .update(users)
    .set({
      name: input.name,
      email: input.email,
      role: input.role,
      themeDeveloper: Boolean(input.themeDeveloper),
      ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
    })
    .where(eq(users.id, id));
  if (input.password) await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
}

export async function deleteUser(id: number, currentUserId: number) {
  if (id === currentUserId) throw new UserError("Non puoi eliminare il tuo account.");
  const current = await getUserById(id);
  if (!current) return;
  if (current.role === "admin" && (await adminCount(id)) === 0)
    throw new UserError("Deve restare almeno un amministratore.");
  await db.delete(users).where(eq(users.id, id));
}
