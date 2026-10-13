import { createHmac, timingSafeEqual } from "node:crypto";
import { redirect } from "react-router";
import { env } from "./env";
import { getSetting } from "./settings";

// Origine separata per il pannello (ADMIN_URL, facoltativa). Il JS del tema e l'HTML dei contenuti
// girano sull'origine pubblica; la sessione del pannello vive solo sull'origine del pannello, dove il
// codice del tema non viene mai eseguito. Sull'origine del pannello il front si vede solo dentro gli
// iframe di anteprima (senza script); aperto direttamente viene rediretto al sito pubblico.

const hostOf = (url: string) => new URL(url).host;

/** La richiesta arriva sull'origine separata del pannello. */
export function isAdminHost(request: Request) {
  return env.adminUrl !== null && hostOf(request.url) === hostOf(env.adminUrl);
}

/** Origine pubblica configurata (Impostazioni → Generali), se c'è. */
async function publicOrigin() {
  const configured = (await getSetting("siteUrl")).trim();
  return configured ? new URL(configured).origin : null;
}

/** Base degli URL del pannello: l'origine separata, se configurata, altrimenti quella della richiesta. */
export function adminBaseUrl(request: Request) {
  return env.adminUrl ?? new URL(request.url).origin;
}

/** Base degli URL del front da usare nel pannello: "" se il pannello sta sulla stessa origine. */
export async function frontBaseUrl() {
  return env.adminUrl ? ((await publicOrigin()) ?? "") : "";
}

const ADMIN_PATH = /^\/admin(\/|\.data$|$)/;
/** Percorsi serviti su entrambe le origini: API e MCP (con key, senza cookie), media e asset del tema. */
const SHARED_PATH = /^\/((api|uploads|_np)\/|mcp$)/;

/**
 * Smista le richieste tra le due origini. Restituisce una risposta da dare subito (redirect, robots)
 * oppure null per proseguire.
 */
export async function routeByOrigin(request: Request): Promise<Response | null> {
  if (!env.adminUrl) return null;
  const url = new URL(request.url);
  const path = url.pathname;

  if (!isAdminHost(request)) {
    // Sito pubblico: il pannello sta altrove.
    return ADMIN_PATH.test(path) ? redirect(env.adminUrl + path + url.search) : null;
  }

  if (ADMIN_PATH.test(path) || SHARED_PATH.test(path)) return null;
  if (path === "/robots.txt") {
    return new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  // Anteprime del pannello: l'attivazione (?np_preview) e le pagine dentro gli iframe.
  if (url.searchParams.has("np_preview") || request.headers.get("Sec-Fetch-Dest") === "iframe") return null;

  const target = await publicOrigin();
  if (target) return redirect(target + path + url.search);
  return new Response("Imposta l'URL pubblico del sito in Impostazioni → Generali.", { status: 404 });
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Protezione CSRF per il pannello: le richieste che modificano dati devono partire dalla stessa origine.
 * SameSite=Strict non basta tra sottodomini dello stesso sito (www → admin sono "same-site").
 */
export function checkSameOrigin(request: Request) {
  if (SAFE_METHODS.has(request.method) || !ADMIN_PATH.test(new URL(request.url).pathname)) return;
  const site = request.headers.get("Sec-Fetch-Site");
  const origin = request.headers.get("Origin");
  const crossSite = site !== null && site !== "same-origin" && site !== "none";
  const otherOrigin = origin !== null && (origin === "null" || hostOf(origin) !== hostOf(request.url));
  if (crossSite || otherOrigin) throw new Response("Richiesta da un'altra origine.", { status: 403 });
}

// --- Token di anteprima ---
// Firmati con SESSION_SECRET: chi li ha vede la bozza di quel tema fino alla scadenza, senza bisogno
// della sessione. Servono per aprire l'anteprima sull'origine pubblica, dove la sessione non c'è.

export const PREVIEW_TTL = 30 * 60;

function sign(payload: string) {
  return createHmac("sha256", env.sessionSecret).update(`np_preview:${payload}`).digest("base64url");
}

export function createPreviewToken(theme: string) {
  const payload = `${theme}.${Math.floor(Date.now() / 1000) + PREVIEW_TTL}`;
  return `${payload}.${sign(payload)}`;
}

/** Il nome del tema se il token è valido e non scaduto, altrimenti null. */
export function verifyPreviewToken(token: string) {
  const match = /^([a-z0-9][a-z0-9-]*)\.(\d+)\.([\w-]+)$/.exec(token);
  if (!match) return null;
  const [, theme, expires, signature] = match;
  const expected = Buffer.from(sign(`${theme}.${expires}`));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return Number(expires) * 1000 > Date.now() ? theme : null;
}

/** URL che apre l'anteprima della bozza sul front (sull'origine pubblica, se separata). */
export async function previewUrl(theme: string, path = "/") {
  const query = `np_preview=${encodeURIComponent(theme)}&np_token=${encodeURIComponent(createPreviewToken(theme))}`;
  return `${await frontBaseUrl()}${path}${path.includes("?") ? "&" : "?"}${query}`;
}
