import { ensureMigrated } from "~/.server/db";
import { handleOAuth, OAuthError, revokeToken } from "~/.server/oauth";
import type { Route } from "./+types/revoke";

// Revoca dei token (RFC 7009).
export const action = ({ request }: Route.ActionArgs) =>
  handleOAuth(request, async () => {
    await ensureMigrated();
    return revokeToken(request);
  });

export const loader = ({ request }: Route.LoaderArgs) =>
  handleOAuth(request, async () => {
    throw new OAuthError("invalid_request", "Usa POST.", 405);
  });
