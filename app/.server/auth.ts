import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, count, eq, gt, isNull, lt } from "drizzle-orm";
import { createContext, createCookie, redirect, type RouterContextProvider } from "react-router";
import { can, type Permission } from "~/lib/roles";
import { db, schema } from "./db";
import type { User } from "./db/schema";
import { env } from "./env";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

const SESSION_DAYS = 30;

export const sessionCookie = createCookie("np_session", {
  httpOnly: true,
  // Strict: il cookie non parte mai da un altro sito, nemmeno seguendo un link.
  sameSite: "strict",
  path: "/",
  secure: env.isProduction,
  secrets: [env.sessionSecret],
  maxAge: SESSION_DAYS * 24 * 60 * 60,
});

export type SessionUser = Pick<User, "id" | "email" | "name" | "role" | "themeDeveloper">;

export const userContext = createContext<SessionUser | null>(null);

// --- Password ---

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algo, saltHex, hashHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

// --- Sessioni ---

export async function createUserSession(userId: number, redirectTo: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(schema.sessions).values({ id: sha256(token), userId, expiresAt });
  // Pulizia opportunistica delle sessioni scadute.
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
  throw redirect(redirectTo, {
    headers: { "Set-Cookie": await sessionCookie.serialize(token) },
  });
}

export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const token = await sessionCookie.parse(request.headers.get("Cookie"));
  if (typeof token !== "string" || !token) return null;
  const [row] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
      themeDeveloper: schema.users.themeDeveloper,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sha256(token)), gt(schema.sessions.expiresAt, new Date())));
  return row ?? null;
}

export async function logout(request: Request) {
  const token = await sessionCookie.parse(request.headers.get("Cookie"));
  if (typeof token === "string") {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
  }
  throw redirect("/admin/login", {
    headers: { "Set-Cookie": await sessionCookie.serialize("", { maxAge: 0 }) },
  });
}

export async function login(email: string, password: string) {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email.trim().toLowerCase()));
  if (!user) {
    // Tempo costante approssimativo anche per utenti inesistenti.
    await hashPassword(password);
    return null;
  }
  return (await verifyPassword(password, user.passwordHash)) ? user : null;
}

export async function needsSetup() {
  const [row] = await db.select({ n: count() }).from(schema.users);
  return row.n === 0;
}

// --- Contesto e permessi ---

export function getUser(context: Readonly<RouterContextProvider>): SessionUser {
  const user = context.get(userContext);
  if (!user) throw redirect("/admin/login");
  return user;
}

export function requirePermission(context: Readonly<RouterContextProvider>, permission: Permission) {
  const user = getUser(context);
  if (!can(user, permission)) {
    throw new Response("Non hai i permessi per questa sezione.", { status: 403 });
  }
  return user;
}

// --- Reset password ---

export async function createPasswordReset(userId: number) {
  const token = randomToken();
  await db.insert(schema.passwordResets).values({
    id: sha256(token),
    userId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return token;
}

export async function findPasswordReset(token: string) {
  const [row] = await db
    .select()
    .from(schema.passwordResets)
    .where(
      and(
        eq(schema.passwordResets.id, sha256(token)),
        gt(schema.passwordResets.expiresAt, new Date()),
        isNull(schema.passwordResets.usedAt),
      ),
    );
  return row ?? null;
}

export async function consumePasswordReset(token: string, password: string) {
  const reset = await findPasswordReset(token);
  if (!reset) return false;
  await db.transaction(async (tx) => {
    await tx
      .update(schema.passwordResets)
      .set({ usedAt: new Date() })
      .where(eq(schema.passwordResets.id, reset.id));
    await tx
      .update(schema.users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(schema.users.id, reset.userId));
    // Invalida tutte le sessioni esistenti.
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, reset.userId));
  });
  return true;
}
