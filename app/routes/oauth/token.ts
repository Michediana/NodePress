import { ensureMigrated } from "~/.server/db";
import { exchangeToken, handleOAuth, OAuthError } from "~/.server/oauth";
import type { Route } from "./+types/token";

// Token endpoint: authorization_code (con PKCE) e refresh_token.
export const action = ({ request }: Route.ActionArgs) =>
  handleOAuth(request, async () => {
    await ensureMigrated();
    return exchangeToken(request);
  });

export const loader = ({ request }: Route.LoaderArgs) =>
  handleOAuth(request, async () => {
    throw new OAuthError("invalid_request", "Usa POST.", 405);
  });
