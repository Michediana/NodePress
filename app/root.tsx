import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useMatches } from "react-router";

import type { Route } from "./+types/root";
import { useNonce } from "./lib/csp";
import { ensureMigrated } from "./.server/db";
import { checkSameOrigin, routeByOrigin } from "./.server/origins";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
];

export const middleware: Route.MiddlewareFunction[] = [
  async ({ request }) => {
    // Protezione CSRF delle richieste di scrittura, poi smistamento tra sito e pannello (ADMIN_URL).
    checkSameOrigin(request);
    await ensureMigrated();
    const routed = await routeByOrigin(request);
    if (routed) throw routed;
  },
];

function useDocumentLang() {
  const matches = useMatches();
  for (const match of [...matches].reverse()) {
    const data = match.loaderData as { lang?: unknown } | undefined;
    if (data && typeof data.lang === "string") return data.lang;
  }
  return "it";
}

export function Layout({ children }: { children: React.ReactNode }) {
  const lang = useDocumentLang();
  const nonce = useNonce();
  return (
    <html lang={lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links nonce={nonce} />
      </head>
      <body>
        {children}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Errore";
  let details = "Si è verificato un errore inatteso.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : `${error.status}`;
    details =
      error.status === 404
        ? "La pagina richiesta non esiste."
        : typeof error.data === "string"
          ? error.data
          : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  // Nessun CSS qui: la root non carica né il CSS del pannello né quello del tema.
  return (
    <main style={{ maxWidth: "64rem", margin: "0 auto", padding: "4rem 1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>{message}</h1>
      <p style={{ color: "#666", whiteSpace: "pre-wrap" }}>{details}</p>
      {stack && (
        <pre style={{ overflowX: "auto", padding: "1rem", fontSize: "0.75rem" }}>
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
