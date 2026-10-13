import { authorizationServerMetadata, handleOAuth, oauthJson } from "~/.server/oauth";
import type { Route } from "./+types/server-metadata";

// Metadati dell'authorization server (RFC 8414).
export const loader = ({ request }: Route.LoaderArgs) =>
  handleOAuth(request, async () => oauthJson(authorizationServerMetadata(request)));
