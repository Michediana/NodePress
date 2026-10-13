import { handleMcpRequest } from "~/.server/mcp";
import type { Route } from "./+types/mcp";

// Endpoint MCP: vedi app/.server/mcp.
export const loader = ({ request }: Route.LoaderArgs) => handleMcpRequest(request);
export const action = ({ request }: Route.ActionArgs) => handleMcpRequest(request);
