import { z } from "zod";
import { can } from "~/lib/roles";
import { findApiKey, type ApiScope } from "./api-keys";
import type { SessionUser } from "./auth";
import { db, ensureMigrated, schema } from "./db";
import { UserError } from "./forms";
import { getSetting } from "./settings";
import { eq } from "drizzle-orm";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, X-API-Key, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, ...headers } });
}

function extractKey(request: Request) {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return request.headers.get("X-API-Key")?.trim() || null;
}

export type ApiAuth = { scope: ApiScope | "public"; user: SessionUser | null };

/** Scope delle key accettati per ciascun livello richiesto: una key theme vale solo per le API dei temi. */
const ACCEPTED_SCOPES: Record<ApiScope, ApiScope[]> = {
  read: ["read", "admin"],
  admin: ["admin"],
  theme: ["theme", "admin"],
};

/** Verifica la API key. Le letture sono libere se l'impostazione "API pubblica" è attiva. */
export async function authenticate(request: Request, required: ApiScope): Promise<ApiAuth> {
  const key = extractKey(request);
  if (!key) {
    if (required === "read" && (await getSetting("publicApi"))) return { scope: "public", user: null };
    throw new ApiError(401, "API key mancante.");
  }
  const row = await findApiKey(key);
  if (!row) throw new ApiError(401, "API key non valida.");
  if (!ACCEPTED_SCOPES[required].includes(row.scope)) {
    throw new ApiError(
      403,
      `Questa API key ha lo scope ${row.scope}: serve ${required === "theme" ? "theme o admin" : required}.`,
    );
  }
  let user: SessionUser | null = null;
  const [creator] = row.createdBy ? await db.select().from(schema.users).where(eq(schema.users.id, row.createdBy)) : [];
  if (row.scope === "theme") {
    // Una key theme vale finché chi l'ha creata può ancora modificare il codice dei temi.
    if (!creator || !can(creator, "themes.code"))
      throw new ApiError(403, "Chi ha creato questa API key non può modificare il codice dei temi.");
    user = {
      id: creator.id,
      email: creator.email,
      name: creator.name,
      role: creator.role,
      themeDeveloper: creator.themeDeveloper,
    };
  } else if (creator) {
    // Le key admin agiscono con i permessi di amministratore.
    user = {
      id: creator.id,
      email: creator.email,
      name: creator.name,
      role: "admin",
      themeDeveloper: creator.themeDeveloper,
    };
  }
  return { scope: row.scope, user };
}

/** Avvolge un handler API: gestisce preflight CORS, errori e serializzazione JSON. */
export async function handle(request: Request, fn: () => Promise<unknown>) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  try {
    await ensureMigrated();
    const result = await fn();
    if (result instanceof Response) return result;
    return json(result ?? { ok: true });
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message, details: error.details }, error.status);
    if (error instanceof UserError) return json({ error: error.message, fields: error.fieldErrors }, error.status);
    if (error instanceof Response) {
      const location = error.headers.get("Location");
      if (location) return json({ redirect: location, status: error.status }, 200);
      return json({ error: (await error.text()) || error.statusText || "Errore" }, error.status);
    }
    console.error(error);
    return json({ error: "Errore interno." }, 500);
  }
}

export function methodNotAllowed(): never {
  throw new ApiError(405, "Metodo non consentito.");
}

export async function readJson<T extends z.ZodType>(request: Request, schemaDef: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, "Body JSON non valido.");
  }
  const parsed = schemaDef.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "Dati non validi.", z.flattenError(parsed.error).fieldErrors);
  return parsed.data;
}

export function intParam(value: string | undefined | null, name = "id") {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, `Parametro "${name}" non valido.`);
  return n;
}

export function langParam(url: URL, codes: string[], fallback: string) {
  const lang = url.searchParams.get("lang") ?? fallback;
  if (!codes.includes(lang)) throw new ApiError(400, `Lingua "${lang}" non attiva.`);
  return lang;
}
