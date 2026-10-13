import { ensureMigrated } from "~/.server/db";
import { handleOAuth, OAuthError, oauthJson, registerClient } from "~/.server/oauth";
import type { Route } from "./+types/register";

// Registrazione dinamica dei client (RFC 7591).
export const action = ({ request }: Route.ActionArgs) =>
  handleOAuth(request, async () => {
    if (request.method !== "POST") throw new OAuthError("invalid_request", "Usa POST.", 405);
    await ensureMigrated();
    const body = await request.json().catch(() => {
      throw new OAuthError("invalid_client_metadata", "Body JSON non valido.");
    });
    return oauthJson(await registerClient(request, body), 201);
  });

export const loader = ({ request }: Route.LoaderArgs) =>
  handleOAuth(request, async () => {
    throw new OAuthError("invalid_request", "Usa POST.", 405);
  });
