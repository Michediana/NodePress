import { ensureMigrated } from "~/.server/db";
import { handleOAuth, oauthJson, protectedResourceMetadata } from "~/.server/oauth";
import type { Route } from "./+types/protected-resource";

// Metadati della risorsa protetta (RFC 9728): /.well-known/oauth-protected-resource[/mcp].
export const loader = ({ request }: Route.LoaderArgs) =>
  handleOAuth(request, async () => {
    await ensureMigrated();
    return oauthJson(await protectedResourceMetadata(request));
  });
