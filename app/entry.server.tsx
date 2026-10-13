// Entry server di React Router (come quello di default) con la Content Security Policy del front:
// un nonce per richiesta, passato a React Router e ai componenti tramite NonceContext.

import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import { adminOriginFrontCsp, cspHeader, createNonce } from "~/.server/csp";
import { isAdminHost } from "~/.server/origins";
import { env } from "~/.server/env";
import { getSetting } from "~/.server/settings";
import { NonceContext, type CspMode } from "~/lib/csp";

export const streamTimeout = 5_000;

/** La CSP vale per il front; il pannello (Monaco, editor visuale) ne resta fuori. */
const isFront = (request: Request) => !/^\/admin(\/|$)/.test(new URL(request.url).pathname);

async function cspMode(): Promise<CspMode> {
  try {
    return await getSetting("cspMode");
  } catch {
    // DB non raggiungibile (es. pagina d'errore): meglio la policy che nessuna.
    return "enforce";
  }
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  }

  let nonce: string | undefined;
  if (isFront(request) && isAdminHost(request)) {
    const header = adminOriginFrontCsp();
    responseHeaders.set(header.name, header.value);
    responseHeaders.set("X-Robots-Tag", "noindex");
  } else if (isFront(request)) {
    const candidate = createNonce();
    const header = cspHeader(candidate, {
      mode: await cspMode(),
      dev: !env.isProduction,
      https: env.isProduction,
      adminUrl: env.adminUrl,
    });
    if (header) {
      nonce = candidate;
      responseHeaders.set(header.name, header.value);
    }
  }

  return new Promise<Response>((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");

    // Bot e SPA mode aspettano tutto il contenuto prima di rispondere.
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady";

    // Interrompe il rendering dopo streamTimeout, lasciando il tempo di inviare i boundary rifiutati.
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => abort(), streamTimeout + 1000);

    const { pipe, abort } = renderToPipeableStream(
      <NonceContext.Provider value={nonce}>
        <ServerRouter context={routerContext} url={request.url} nonce={nonce} />
      </NonceContext.Provider>,
      {
        nonce,
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          pipe(body);
          resolve(new Response(stream, { headers: responseHeaders, status: responseStatusCode }));
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Gli errori del primo rendering li registra già handleDocumentRequest.
          if (shellRendered) console.error(error);
        },
      },
    );
  });
}
