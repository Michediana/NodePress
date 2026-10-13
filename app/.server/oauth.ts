import { createHash, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, lt, notExists, or, sql } from "drizzle-orm";
import { can } from "~/lib/roles";
import { randomToken, sha256, type SessionUser } from "./auth";
import { db, schema } from "./db";
import type { OAuthClient } from "./db/schema";
import { env } from "./env";
import { fetchPublic } from "./net";
import { adminBaseUrl } from "./origins";
import { getSetting } from "./settings";

// Authorization server OAuth 2.1 per il server MCP (/mcp), secondo la specifica di autorizzazione MCP:
// - metadati della risorsa (RFC 9728) e dell'authorization server (RFC 8414);
// - client pubblici, registrati con la registrazione dinamica (RFC 7591) oppure identificati da un
//   Client ID Metadata Document (client_id = URL https dei metadati);
// - authorization code con PKCE S256 obbligatorio, consenso nel pannello con la sessione dell'utente;
// - token legati alla risorsa (RFC 8707): valgono solo per /mcp, non per le API REST;
// - refresh token ruotati a ogni uso, con revoca della concessione se un token vecchio viene riusato.

export type OAuthScope = "admin" | "theme";
export const OAUTH_SCOPES: OAuthScope[] = ["admin", "theme"];

const ACCESS_TTL = 60 * 60; // secondi
const REFRESH_TTL = 30 * 24 * 60 * 60;
const CODE_TTL = 60;
const METADATA_TTL = 24 * 60 * 60 * 1000;
const METADATA_MAX_BYTES = 64 * 1024;
const REGISTRATIONS_PER_HOUR = 20;

/** Errore OAuth: `code` è il codice standard (invalid_request, invalid_grant…). */
export class OAuthError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const OAUTH_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version",
};

export function oauthJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { ...OAUTH_CORS, "Cache-Control": "no-store" } });
}

/** Gestisce preflight CORS ed errori OAuth degli endpoint del server di autorizzazione. */
export async function handleOAuth(request: Request, fn: () => Promise<Response>) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: OAUTH_CORS });
  try {
    return await fn();
  } catch (error) {
    if (error instanceof OAuthError)
      return oauthJson({ error: error.code, error_description: error.message }, error.status);
    console.error(error);
    return oauthJson({ error: "server_error", error_description: "Errore interno." }, 500);
  }
}

// --- URL e metadati ---

/** Issuer: l'origine del pannello, dove vivono la sessione e la pagina di consenso. */
export const issuerUrl = (request: Request) => adminBaseUrl(request);

export const mcpResourceUrl = (request: Request) => `${new URL(request.url).origin}/mcp`;

/** Confronto tra risorse senza schema né slash finale: dietro un proxy la richiesta può arrivare in http. */
function resourceKey(value: string) {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return null;
  }
}

/** Indirizzi da cui si raggiunge /mcp: origine della richiesta, URL pubblico e origine del pannello. */
async function knownResources(request: Request) {
  const origins = [new URL(request.url).origin, env.adminUrl, (await getSetting("siteUrl")).trim()];
  return new Set(origins.filter(Boolean).map((origin) => resourceKey(`${origin}/mcp`)));
}

export async function isKnownResource(request: Request, resource: string) {
  const key = resourceKey(resource);
  return key !== null && (await knownResources(request)).has(key);
}

export async function protectedResourceMetadata(request: Request) {
  return {
    resource: mcpResourceUrl(request),
    authorization_servers: [issuerUrl(request)],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: await getSetting("siteName"),
  };
}

export function authorizationServerMetadata(request: Request) {
  const issuer = issuerUrl(request);
  return {
    issuer,
    authorization_endpoint: `${issuer}/admin/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    scopes_supported: OAUTH_SCOPES,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

// --- Permessi ---

/** Scope che un utente può concedere: admin solo agli amministratori, theme a chi modifica il codice dei temi. */
export function allowedScopes(user: Pick<SessionUser, "role" | "themeDeveloper">): OAuthScope[] {
  const scopes: OAuthScope[] = [];
  if (user.role === "admin") scopes.push("admin");
  if (can(user, "themes.code")) scopes.push("theme");
  return scopes;
}

// --- Client ---

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "file:", "blob:", "vbscript:", "about:"]);

/**
 * redirect_uri ammessi: https, http solo verso il computer locale (app native, CLI) e schemi privati
 * delle app native (es. cursor://). Mai frammenti.
 */
export function validRedirectUri(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || FORBIDDEN_SCHEMES.has(url.protocol)) return false;
  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);
  return true;
}

/** Il redirect_uri richiesto è registrato; per il loopback la porta può cambiare (RFC 8252). */
function redirectRegistered(client: OAuthClient, value: string) {
  if (client.redirectUris.includes(value)) return true;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) return false;
  url.port = "";
  return client.redirectUris.some((registered) => {
    try {
      const other = new URL(registered);
      if (other.protocol !== "http:" || !LOOPBACK_HOSTS.has(other.hostname)) return false;
      other.port = "";
      return other.href === url.href;
    } catch {
      return false;
    }
  });
}

const isMetadataUrl = (clientId: string) => {
  try {
    const url = new URL(clientId);
    return url.protocol === "https:" && url.pathname !== "/";
  } catch {
    return false;
  }
};

async function findClient(clientId: string) {
  const [row] = await db.select().from(schema.oauthClients).where(eq(schema.oauthClients.clientId, clientId));
  return row ?? null;
}

/** Legge (o rilegge, se vecchio) il Client ID Metadata Document di un client. */
async function loadMetadataClient(clientId: string) {
  const cached = await findClient(clientId);
  if (cached?.fetchedAt && Date.now() - cached.fetchedAt.getTime() < METADATA_TTL) return cached;
  let doc: Record<string, unknown>;
  try {
    const { data } = await fetchPublic(clientId, {
      maxBytes: METADATA_MAX_BYTES,
      timeout: 10_000,
      httpsOnly: true,
      accept: "application/json",
    });
    doc = JSON.parse(data.toString("utf8"));
  } catch (error) {
    // Se il documento non è raggiungibile ma era già noto, si usa la copia salvata.
    if (cached) return cached;
    throw new OAuthError("invalid_client", `Metadati del client non leggibili: ${(error as Error).message}`);
  }
  if (doc.client_id !== clientId) throw new OAuthError("invalid_client", "Il client_id nei metadati non corrisponde.");
  const redirectUris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.map(String) : [];
  if (!redirectUris.length || !redirectUris.every(validRedirectUri))
    throw new OAuthError("invalid_client", "redirect_uris mancanti o non validi nei metadati del client.");
  const values = {
    name: String(doc.client_name ?? new URL(clientId).host).slice(0, 255),
    clientUri: typeof doc.client_uri === "string" ? doc.client_uri.slice(0, 1000) : null,
    redirectUris,
    fetchedAt: new Date(),
  };
  if (cached) {
    await db.update(schema.oauthClients).set(values).where(eq(schema.oauthClients.id, cached.id));
  } else {
    await db.insert(schema.oauthClients).values({ ...values, clientId, metadataDocument: true });
  }
  return (await findClient(clientId))!;
}

export async function resolveClient(clientId: string) {
  if (!clientId) return null;
  if (isMetadataUrl(clientId)) return loadMetadataClient(clientId);
  return findClient(clientId);
}

const registrations = new Map<string, number[]>();

/** Limite di registrazioni per indirizzo: la registrazione dinamica è aperta a chiunque. */
function checkRegistrationRate(request: Request) {
  const ip = request.headers.get("X-Forwarded-For")?.split(",")[0].trim() || "local";
  const since = Date.now() - 60 * 60 * 1000;
  const recent = (registrations.get(ip) ?? []).filter((t) => t > since);
  if (recent.length >= REGISTRATIONS_PER_HOUR)
    throw new OAuthError("invalid_request", "Troppe registrazioni da questo indirizzo: riprova più tardi.", 429);
  recent.push(Date.now());
  registrations.set(ip, recent);
}

/** Registrazione dinamica (RFC 7591): crea un client pubblico. */
export async function registerClient(request: Request, body: unknown) {
  checkRegistrationRate(request);
  const input = (body ?? {}) as Record<string, unknown>;
  const redirectUris = Array.isArray(input.redirect_uris) ? input.redirect_uris.map(String) : [];
  if (!redirectUris.length) throw new OAuthError("invalid_redirect_uri", "redirect_uris è obbligatorio.");
  const invalid = redirectUris.find((uri) => !validRedirectUri(uri));
  if (invalid) throw new OAuthError("invalid_redirect_uri", `redirect_uri non ammesso: ${invalid}`);
  const grantTypes = Array.isArray(input.grant_types) ? input.grant_types.map(String) : ["authorization_code"];
  if (grantTypes.some((g) => g !== "authorization_code" && g !== "refresh_token"))
    throw new OAuthError("invalid_client_metadata", "Sono ammessi solo authorization_code e refresh_token.");
  const name = typeof input.client_name === "string" && input.client_name.trim() ? input.client_name.trim() : null;
  const clientUri = typeof input.client_uri === "string" ? input.client_uri.slice(0, 1000) : null;

  // Pulizia: client registrati da più di una settimana, mai autorizzati.
  await db
    .delete(schema.oauthClients)
    .where(
      and(
        eq(schema.oauthClients.metadataDocument, false),
        isNull(schema.oauthClients.lastUsedAt),
        lt(schema.oauthClients.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
        notExists(db.select().from(schema.oauthGrants).where(eq(schema.oauthGrants.clientId, schema.oauthClients.id))),
      ),
    );

  const clientId = `npc_${randomToken(16)}`;
  await db.insert(schema.oauthClients).values({
    clientId,
    name: (name || new URL(redirectUris[0]).host || "Client MCP").slice(0, 255),
    clientUri,
    redirectUris,
  });
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name ?? undefined,
    client_uri: clientUri ?? undefined,
    redirect_uris: redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

// --- Richiesta di autorizzazione ---

export type AuthorizeRequest = {
  client: OAuthClient;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scope: OAuthScope | null;
  resource: string;
};

/** URL di ritorno al client con i parametri indicati (e `iss`, RFC 9207). */
export function clientRedirect(request: Request, redirectUri: string, params: Record<string, string | null>) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value !== null) url.searchParams.set(key, value);
  url.searchParams.set("iss", issuerUrl(request));
  return url.toString();
}

/**
 * Valida i parametri di /authorize. Client e redirect_uri non validi si mostrano all'utente (`fatal`):
 * rimandare a un URL non verificato aprirebbe un redirect arbitrario. Gli altri errori tornano al client.
 */
export async function parseAuthorizeRequest(
  request: Request,
  params: URLSearchParams,
): Promise<{ fatal: string } | { redirect: string } | { ok: AuthorizeRequest }> {
  const clientId = params.get("client_id") ?? "";
  let client: OAuthClient | null;
  try {
    client = await resolveClient(clientId);
  } catch (error) {
    return { fatal: (error as Error).message };
  }
  if (!client) return { fatal: "Applicazione sconosciuta: client_id non registrato." };
  const redirectUri = params.get("redirect_uri") ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!redirectUri || !redirectRegistered(client, redirectUri))
    return { fatal: "L'indirizzo di ritorno (redirect_uri) non è registrato per questa applicazione." };

  const state = params.get("state");
  const fail = (error: string, description: string) => ({
    redirect: clientRedirect(request, redirectUri, { error, error_description: description, state }),
  });
  if (params.get("response_type") !== "code") return fail("unsupported_response_type", "Serve response_type=code.");
  const codeChallenge = params.get("code_challenge") ?? "";
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) return fail("invalid_request", "PKCE: code_challenge mancante.");
  if (params.get("code_challenge_method") !== "S256")
    return fail("invalid_request", "PKCE: è ammesso solo code_challenge_method=S256.");
  const resource = params.get("resource") ?? mcpResourceUrl(request);
  if (!(await isKnownResource(request, resource)))
    return fail("invalid_target", "La risorsa richiesta non è il server MCP di questo sito.");
  const requested = (params.get("scope") ?? "")
    .split(/\s+/)
    .filter((s): s is OAuthScope => OAUTH_SCOPES.includes(s as OAuthScope));
  // Più scope richiesti: si propone il più ampio, l'utente sceglie nel consenso.
  const scope = requested.includes("admin") ? "admin" : (requested[0] ?? null);
  return { ok: { client, redirectUri, state, codeChallenge, scope, resource } };
}

/** Crea il codice di autorizzazione dopo il consenso e restituisce l'URL di ritorno al client. */
export async function approveAuthorization(
  request: Request,
  auth: AuthorizeRequest,
  user: SessionUser,
  scope: OAuthScope,
) {
  if (!allowedScopes(user).includes(scope))
    throw new OAuthError("access_denied", "Non puoi concedere questo accesso.", 403);
  const code = `npa_${randomToken(32)}`;
  await db.insert(schema.oauthCodes).values({
    id: sha256(code),
    clientId: auth.client.id,
    userId: user.id,
    scope,
    redirectUri: auth.redirectUri,
    codeChallenge: auth.codeChallenge,
    resource: auth.resource,
    expiresAt: new Date(Date.now() + CODE_TTL * 1000),
  });
  return clientRedirect(request, auth.redirectUri, { code, state: auth.state });
}

// --- Token ---

type TokenParams = Record<string, string>;

/** Parametri del token endpoint: form urlencoded (standard) o JSON; client_id anche da Basic. */
export async function readTokenParams(request: Request): Promise<TokenParams> {
  const type = request.headers.get("Content-Type") ?? "";
  let params: TokenParams = {};
  if (type.includes("application/json")) {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") throw new OAuthError("invalid_request", "Body non valido.");
    params = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)]));
  } else {
    params = Object.fromEntries(new URLSearchParams(await request.text()));
  }
  const basic = request.headers.get("Authorization");
  if (!params.client_id && basic?.startsWith("Basic ")) {
    const decoded = Buffer.from(basic.slice(6), "base64").toString("utf8");
    params.client_id = decodeURIComponent(decoded.split(":")[0] ?? "");
  }
  return params;
}

function verifyPkce(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

async function requireClient(params: TokenParams) {
  const client = params.client_id ? await resolveClient(params.client_id) : null;
  if (!client) throw new OAuthError("invalid_client", "client_id mancante o sconosciuto.", 401);
  return client;
}

/** L'utente può ancora concedere lo scope (ruolo e capability vengono ricontrollati). */
async function userForScope(userId: number, scope: OAuthScope) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user || !allowedScopes(user).includes(scope))
    throw new OAuthError("invalid_grant", "L'utente non ha più i permessi per questo accesso.");
  return user;
}

function newTokens() {
  const access = `npo_${randomToken(32)}`;
  const refresh = `npr_${randomToken(32)}`;
  return {
    access,
    refresh,
    values: {
      accessHash: sha256(access),
      accessExpiresAt: new Date(Date.now() + ACCESS_TTL * 1000),
      refreshHash: sha256(refresh),
      refreshExpiresAt: new Date(Date.now() + REFRESH_TTL * 1000),
    },
  };
}

const tokenResponse = (tokens: ReturnType<typeof newTokens>, scope: OAuthScope) =>
  oauthJson({
    access_token: tokens.access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
    refresh_token: tokens.refresh,
    scope,
  });

async function cleanup() {
  const now = new Date();
  await db.delete(schema.oauthCodes).where(lt(schema.oauthCodes.expiresAt, now));
  await db.delete(schema.oauthGrants).where(lt(schema.oauthGrants.refreshExpiresAt, now));
}

export async function exchangeToken(request: Request) {
  if (request.method !== "POST") throw new OAuthError("invalid_request", "Usa POST.", 405);
  const params = await readTokenParams(request);
  if (params.grant_type === "authorization_code") return exchangeCode(params);
  if (params.grant_type === "refresh_token") return refresh(params);
  throw new OAuthError("unsupported_grant_type", "Sono ammessi authorization_code e refresh_token.");
}

async function exchangeCode(params: TokenParams) {
  const client = await requireClient(params);
  const id = sha256(params.code ?? "");
  // Il codice è monouso: lo si elimina subito, anche se la verifica poi fallisce.
  const [code] = await db.select().from(schema.oauthCodes).where(eq(schema.oauthCodes.id, id));
  if (code) await db.delete(schema.oauthCodes).where(eq(schema.oauthCodes.id, id));
  if (!code || code.expiresAt < new Date() || code.clientId !== client.id)
    throw new OAuthError("invalid_grant", "Codice di autorizzazione non valido o scaduto.");
  if ((params.redirect_uri ?? code.redirectUri) !== code.redirectUri)
    throw new OAuthError("invalid_grant", "redirect_uri diverso da quello dell'autorizzazione.");
  if (!verifyPkce(params.code_verifier ?? "", code.codeChallenge))
    throw new OAuthError("invalid_grant", "PKCE: code_verifier non valido.");
  if (params.resource && resourceKey(params.resource) !== resourceKey(code.resource))
    throw new OAuthError("invalid_target", "La risorsa non corrisponde a quella autorizzata.");
  await userForScope(code.userId, code.scope);

  const tokens = newTokens();
  await db.insert(schema.oauthGrants).values({
    clientId: client.id,
    userId: code.userId,
    scope: code.scope,
    resource: code.resource,
    ...tokens.values,
  });
  await db.update(schema.oauthClients).set({ lastUsedAt: new Date() }).where(eq(schema.oauthClients.id, client.id));
  await cleanup();
  return tokenResponse(tokens, code.scope);
}

async function refresh(params: TokenParams) {
  const client = await requireClient(params);
  const hash = sha256(params.refresh_token ?? "");
  const [grant] = await db
    .select()
    .from(schema.oauthGrants)
    .where(or(eq(schema.oauthGrants.refreshHash, hash), eq(schema.oauthGrants.previousRefreshHash, hash)));
  if (!grant || grant.clientId !== client.id) throw new OAuthError("invalid_grant", "Refresh token non valido.");
  if (grant.refreshHash !== hash) {
    // Un refresh token già usato torna indietro: qualcuno ne ha una copia. Si revoca tutto.
    await db.delete(schema.oauthGrants).where(eq(schema.oauthGrants.id, grant.id));
    throw new OAuthError("invalid_grant", "Refresh token già usato: l'accesso è stato revocato per sicurezza.");
  }
  if (grant.refreshExpiresAt < new Date()) throw new OAuthError("invalid_grant", "Refresh token scaduto.");
  if (params.scope && params.scope.split(/\s+/).some((s) => s !== grant.scope))
    throw new OAuthError("invalid_scope", "Lo scope non può essere ampliato.");
  if (params.resource && resourceKey(params.resource) !== resourceKey(grant.resource))
    throw new OAuthError("invalid_target", "La risorsa non corrisponde a quella autorizzata.");
  await userForScope(grant.userId, grant.scope);

  const tokens = newTokens();
  await db
    .update(schema.oauthGrants)
    .set({ ...tokens.values, previousRefreshHash: grant.refreshHash })
    .where(eq(schema.oauthGrants.id, grant.id));
  return tokenResponse(tokens, grant.scope);
}

/** Revoca (RFC 7009): accetta access o refresh token; risponde sempre 200. */
export async function revokeToken(request: Request) {
  if (request.method !== "POST") throw new OAuthError("invalid_request", "Usa POST.", 405);
  const params = await readTokenParams(request);
  const hash = sha256(params.token ?? "");
  await db
    .delete(schema.oauthGrants)
    .where(or(eq(schema.oauthGrants.accessHash, hash), eq(schema.oauthGrants.refreshHash, hash)));
  return new Response(null, { status: 200, headers: OAUTH_CORS });
}

export const isOAuthAccessToken = (token: string) => token.startsWith("npo_");

/** Concessione di un access token valido, con l'utente; null se il token non esiste o è scaduto. */
export async function findAccessToken(token: string) {
  const [row] = await db
    .select({ grant: schema.oauthGrants, user: schema.users })
    .from(schema.oauthGrants)
    .innerJoin(schema.users, eq(schema.users.id, schema.oauthGrants.userId))
    .where(eq(schema.oauthGrants.accessHash, sha256(token)));
  if (!row || row.grant.accessExpiresAt < new Date()) return null;
  if (!row.grant.lastUsedAt || Date.now() - row.grant.lastUsedAt.getTime() > 60_000) {
    await db.update(schema.oauthGrants).set({ lastUsedAt: new Date() }).where(eq(schema.oauthGrants.id, row.grant.id));
  }
  return row;
}

// --- Gestione dal pannello ---

/** Applicazioni collegate: di un utente, oppure di tutti. */
export async function listGrants(userId?: number) {
  return db
    .select({
      id: schema.oauthGrants.id,
      scope: schema.oauthGrants.scope,
      createdAt: schema.oauthGrants.createdAt,
      lastUsedAt: schema.oauthGrants.lastUsedAt,
      client: schema.oauthClients.name,
      clientUri: schema.oauthClients.clientUri,
      user: schema.users.name,
    })
    .from(schema.oauthGrants)
    .innerJoin(schema.oauthClients, eq(schema.oauthClients.id, schema.oauthGrants.clientId))
    .innerJoin(schema.users, eq(schema.users.id, schema.oauthGrants.userId))
    .where(userId === undefined ? undefined : eq(schema.oauthGrants.userId, userId))
    .orderBy(desc(sql`coalesce(${schema.oauthGrants.lastUsedAt}, ${schema.oauthGrants.createdAt})`));
}

/** Revoca una concessione; con `userId` solo se appartiene a quell'utente. */
export async function deleteGrant(id: number, userId?: number) {
  const [result] = await db
    .delete(schema.oauthGrants)
    .where(
      userId === undefined
        ? eq(schema.oauthGrants.id, id)
        : and(eq(schema.oauthGrants.id, id), eq(schema.oauthGrants.userId, userId)),
    );
  return result.affectedRows > 0;
}

/** Revoca tutti gli accessi di un utente (cambio o reset della password). */
export async function revokeUserGrants(userId: number) {
  await db.delete(schema.oauthGrants).where(eq(schema.oauthGrants.userId, userId));
  await db.delete(schema.oauthCodes).where(eq(schema.oauthCodes.userId, userId));
}
