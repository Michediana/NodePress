import { randomBytes } from "node:crypto";
import type { CspMode } from "~/lib/csp";

// Content Security Policy del front. La parte che conta è script-src: girano solo gli script con
// il nonce della richiesta (quelli di React Router, il JS del tema, lo script del consenso) e, grazie
// a 'strict-dynamic', quelli che questi caricano a loro volta (GTM, GA4, Clarity dopo il consenso,
// import https del tema). Gli script inseriti nell'HTML in altro modo, per esempio nel blocco HTML
// dei contenuti, vengono bloccati. Stili, immagini e font restano più permissivi: i temi usano
// stili inline, @import e font esterni.

export function createNonce() {
  return randomBytes(16).toString("base64");
}

export function cspHeader(nonce: string, options: { mode: CspMode; dev: boolean; https: boolean }) {
  if (options.mode === "off") return null;
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // https: e 'unsafe-inline' servono solo ai browser senza CSP 3: con nonce e 'strict-dynamic' vengono ignorati.
    "script-src": [`'nonce-${nonce}'`, "'strict-dynamic'", "https:", "'unsafe-inline'"],
    "style-src": ["'self'", "'unsafe-inline'", "https:"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:", "https:"],
    "media-src": ["'self'", "blob:", "https:"],
    "connect-src": ["'self'", "https:", ...(options.dev ? ["ws:", "wss:"] : [])],
    "frame-src": ["'self'", "https:"],
    "worker-src": ["'self'", "blob:"],
    "form-action": ["'self'", "https:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    // Il front può stare in un iframe solo del sito stesso (anteprime del pannello).
    "frame-ancestors": ["'self'"],
    ...(options.https ? { "upgrade-insecure-requests": [] } : {}),
  };
  const value = Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(" "))
    .join("; ");
  const name = options.mode === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
  return { name, value };
}
