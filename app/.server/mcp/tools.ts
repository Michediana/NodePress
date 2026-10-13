import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { ApiError } from "../api";
import type { SessionUser } from "../auth";
import { UserError } from "../forms";

/** Chi sta chiamando il server MCP: scope della API key e utente che l'ha creata. */
export type McpContext = {
  scope: "admin" | "theme";
  user: SessionUser | null;
  /** Origine da cui arriva la richiesta, per costruire URL assoluti. */
  origin: string;
};

type ToolConfig<Shape extends z.ZodRawShape> = {
  title: string;
  description: string;
  input?: Shape;
  /** Sola lettura: il client può eseguirlo senza chiedere conferma. */
  readOnly?: boolean;
  /** Elimina o sovrascrive dati in modo non recuperabile. */
  destructive?: boolean;
};

/** Messaggio leggibile per gli errori attesi (validazione, permessi, non trovato). */
async function errorMessage(error: unknown) {
  if (error instanceof UserError) {
    const fields = error.fieldErrors ? ` ${JSON.stringify(error.fieldErrors)}` : "";
    return `${error.message}${fields}`;
  }
  if (error instanceof ApiError)
    return error.details ? `${error.message} ${JSON.stringify(error.details)}` : error.message;
  if (error instanceof Response) return (await error.text()) || error.statusText || `Errore ${error.status}`;
  console.error(error);
  return `Errore interno: ${(error as Error).message}`;
}

const text = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
});

/**
 * Registra un tool: il risultato viene serializzato in JSON e gli errori diventano risposte
 * `isError`, che il modello legge e può correggere invece di interrompere la conversazione.
 */
export function addTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  config: ToolConfig<Shape>,
  run: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>,
) {
  const annotations: ToolAnnotations = {
    title: config.title,
    readOnlyHint: config.readOnly ?? false,
    destructiveHint: config.destructive ?? false,
    openWorldHint: false,
  };
  server.registerTool(
    name,
    { title: config.title, description: config.description, inputSchema: config.input ?? {}, annotations },
    // Il tipo degli argomenti viene dallo schema zod passato in `input`.
    (async (args: z.infer<z.ZodObject<Shape>>) => {
      try {
        return text((await run(args)) ?? { ok: true });
      } catch (error) {
        return { ...text(await errorMessage(error)), isError: true };
      }
    }) as never,
  );
}

/** Rimuove le chiavi undefined (per gli aggiornamenti parziali). */
export function defined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
