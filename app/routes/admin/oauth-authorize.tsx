import { useEffect } from "react";
import { BotIcon, CheckIcon, PaletteIcon, ShieldIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { Form, redirect, useNavigation } from "react-router";
import { getSessionUser } from "~/.server/auth";
import {
  allowedScopes,
  approveAuthorization,
  clientRedirect,
  OAuthError,
  parseAuthorizeRequest,
  type OAuthScope,
} from "~/.server/oauth";
import { getSetting } from "~/.server/settings";
import { AuthCard } from "~/admin/components/auth-card";
import { t } from "~/admin/i18n";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import type { Route } from "./+types/oauth-authorize";

// Consenso OAuth: un'applicazione (es. Claude) chiede di usare il server MCP con l'account dell'utente.

export function meta() {
  return [{ title: t("oauth.title") }, { name: "robots", content: "noindex" }];
}

// La pagina di consenso non si incornicia: un sito esterno potrebbe far cliccare "Consenti" di nascosto.
// Referrer solo verso la stessa origine: l'URL con state e PKCE non arriva all'applicazione, mentre il
// POST del consenso porta ancora l'Origin vero (con no-referrer il browser invia "Origin: null" e il
// controllo CSRF di React Router risponde 400).
export const headers = () => ({
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Referrer-Policy": "same-origin",
});

const BOUNCE = "np_bounce";

/** Dove torna l'utente: l'host del redirect_uri, o lo schema per le app native (es. cursor://). */
function returnTarget(uri: string) {
  const url = new URL(uri);
  return url.host || `${url.protocol}//`;
}

function loginUrl(url: URL) {
  url.searchParams.delete(BOUNCE);
  return `/admin/login?next=${encodeURIComponent(url.pathname + url.search)}`;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const user = await getSessionUser(request);
  // Arrivando da un altro sito il cookie di sessione (SameSite=Strict) non viene inviato: la pagina
  // si ricarica da sola, e la seconda richiesta, partita da qui, lo porta con sé.
  if (!user && request.headers.get("Sec-Fetch-Site") === "cross-site" && !url.searchParams.has(BOUNCE)) {
    url.searchParams.set(BOUNCE, "1");
    return { kind: "bounce" as const, to: url.pathname + url.search, lang: "it" };
  }
  const parsed = await parseAuthorizeRequest(request, url.searchParams);
  if ("fatal" in parsed) return { kind: "error" as const, message: parsed.fatal, lang: "it" };
  if ("redirect" in parsed) throw redirect(parsed.redirect);
  if (!user) throw redirect(loginUrl(url));
  const { client, redirectUri, scope } = parsed.ok;
  const scopes = allowedScopes(user);
  return {
    kind: "consent" as const,
    lang: "it",
    // Dal loader e non da useLocation: la codifica della query deve coincidere tra server e client.
    formAction: url.pathname + url.search,
    siteName: await getSetting("siteName"),
    client: {
      name: client.name,
      uri: client.clientUri,
      returnTo: returnTarget(redirectUri),
      metadataHost: client.metadataDocument ? new URL(client.clientId).host : null,
    },
    user: { name: user.name, email: user.email },
    scopes,
    defaultScope: scope && scopes.includes(scope) ? scope : (scopes[0] ?? null),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const url = new URL(request.url);
  const user = await getSessionUser(request);
  if (!user) throw redirect(loginUrl(url));
  const parsed = await parseAuthorizeRequest(request, url.searchParams);
  if ("fatal" in parsed) return { error: parsed.fatal };
  if ("redirect" in parsed) throw redirect(parsed.redirect);
  const form = await request.formData();
  const { redirectUri, state } = parsed.ok;
  if (form.get("decision") !== "allow") {
    throw redirect(
      clientRedirect(request, redirectUri, {
        error: "access_denied",
        error_description: "L'utente ha rifiutato l'accesso.",
        state,
      }),
    );
  }
  try {
    throw redirect(await approveAuthorization(request, parsed.ok, user, String(form.get("scope")) as OAuthScope));
  } catch (error) {
    if (error instanceof OAuthError) return { error: error.message };
    throw error;
  }
}

const SCOPE_ICONS = { admin: ShieldIcon, theme: PaletteIcon };

function Bounce({ to }: { to: string }) {
  useEffect(() => window.location.replace(to), [to]);
  return (
    <AuthCard title={t("oauth.title")}>
      <meta httpEquiv="refresh" content={`0;url=${to}`} />
      <a className="text-sm underline" href={to}>
        {t("oauth.continue")}
      </a>
    </AuthCard>
  );
}

export default function OAuthAuthorize({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  if (loaderData.kind === "bounce") return <Bounce to={loaderData.to} />;
  if (loaderData.kind === "error") {
    return (
      <AuthCard title={t("oauth.errorTitle")}>
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertDescription>{loaderData.message}</AlertDescription>
        </Alert>
      </AuthCard>
    );
  }
  const { client, user, scopes, defaultScope, siteName, formAction } = loaderData;
  return (
    <AuthCard
      wide
      title={t("oauth.heading", { client: client.name })}
      description={t("oauth.description", { client: client.name, site: siteName })}
    >
      {/* Invio nativo: il consenso finisce con un redirect verso l'applicazione, anche con schemi come cursor://. */}
      <Form method="post" action={formAction} reloadDocument className="flex flex-col gap-5">
        <div className="flex items-start gap-3 rounded-lg border p-3">
          <BotIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 text-sm">
            <div className="font-medium">{client.name}</div>
            <div className="text-muted-foreground">
              {t("oauth.returnTo")} <span className="font-mono text-xs">{client.returnTo}</span>
            </div>
            {client.metadataHost && (
              <div className="text-muted-foreground">
                {t("oauth.publishedBy")} <span className="font-mono text-xs">{client.metadataHost}</span>
              </div>
            )}
          </div>
        </div>

        <p className="text-sm">{t("oauth.signedInAs", { name: user.name, email: user.email })}</p>

        {actionData?.error && (
          <Alert variant="destructive">
            <AlertDescription>{actionData.error}</AlertDescription>
          </Alert>
        )}

        {scopes.length ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t("oauth.scopeLabel")}</legend>
            {scopes.map((scope) => {
              const Icon = SCOPE_ICONS[scope];
              return (
                <label
                  key={scope}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-checked:border-primary has-checked:bg-muted/50"
                >
                  <input
                    type="radio"
                    name="scope"
                    value={scope}
                    defaultChecked={scope === defaultScope}
                    className="mt-1 accent-primary"
                  />
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm">
                    <span className="block font-medium">{t(`oauth.scopes.${scope}.title`)}</span>
                    <span className="block text-muted-foreground">{t(`oauth.scopes.${scope}.description`)}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        ) : (
          <Alert variant="destructive">
            <AlertTitle>{t("oauth.noScopesTitle")}</AlertTitle>
            <AlertDescription>{t("oauth.noScopes")}</AlertDescription>
          </Alert>
        )}

        <Alert>
          <TriangleAlertIcon />
          <AlertDescription>{t("oauth.warning", { client: client.name })}</AlertDescription>
        </Alert>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="submit" name="decision" value="deny" variant="outline" disabled={busy}>
            <XIcon data-icon="inline-start" />
            {t("oauth.deny")}
          </Button>
          {scopes.length > 0 && (
            <Button type="submit" name="decision" value="allow" disabled={busy}>
              {busy ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
              {t("oauth.allow")}
            </Button>
          )}
        </div>
      </Form>
    </AuthCard>
  );
}
