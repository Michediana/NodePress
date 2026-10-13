import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ApiError, authenticate } from "../api";
import { ensureMigrated } from "../db";
import { registerContentTools } from "./content";
import { registerGuideTool, serverInstructions } from "./guide";
import { registerMediaTools } from "./media";
import { registerSiteInfoTool, registerSiteTools } from "./site";
import { registerThemeTools } from "./themes";
import type { McpContext } from "./tools";

// Server MCP (Model Context Protocol): espone la gestione del sito come tool per gli assistenti AI.
// Trasporto HTTP "streamable" senza sessioni: ogni richiesta crea server e transport, autenticati
// con la API key della richiesta. Una key admin vede tutti i tool, una key theme solo quelli dei temi.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, X-API-Key, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
};

function createServer(ctx: McpContext) {
  const server = new McpServer(
    { name: "nodepress", title: "NodePress", version: "1.0.0" },
    { instructions: serverInstructions(ctx), capabilities: { tools: {} } },
  );
  registerGuideTool(server);
  registerSiteInfoTool(server, ctx);
  if (ctx.scope === "admin") {
    registerContentTools(server, ctx);
    registerMediaTools(server, ctx);
    registerSiteTools(server, ctx);
  }
  registerThemeTools(server, ctx);
  return server;
}

/** Errore JSON-RPC fuori dal protocollo (autenticazione), con lo status HTTP corrispondente. */
function errorResponse(status: number, message: string) {
  const headers: Record<string, string> = { ...CORS_HEADERS, "Content-Type": "application/json" };
  if (status === 401) headers["WWW-Authenticate"] = 'Bearer realm="nodepress"';
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }), {
    status,
    headers,
  });
}

function withCors(response: Response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function handleMcpRequest(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  let ctx: McpContext;
  try {
    await ensureMigrated();
    const auth = await authenticate(request, "theme");
    if (auth.scope !== "admin" && auth.scope !== "theme")
      throw new ApiError(403, "Serve una API key con scope admin o theme.");
    ctx = { scope: auth.scope, user: auth.user, origin: new URL(request.url).origin };
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error.status, error.message);
    throw error;
  }
  // Senza sessioni non c'è uno stream da aprire con GET né una sessione da chiudere con DELETE.
  if (request.method !== "POST") return errorResponse(405, "Metodo non consentito: usa POST.");
  const server = createServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(request));
  } finally {
    // Con risposte JSON la richiesta è già conclusa: chiudere libera server e transport.
    void transport.close();
    void server.close();
  }
}
