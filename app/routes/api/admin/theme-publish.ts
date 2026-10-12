import { z } from "zod";
import { ApiError, authenticate, handle, methodNotAllowed } from "~/.server/api";
import { publishTheme } from "~/.server/theme/store";
import type { Route } from "./+types/theme-publish";

// Senza buildId pubblica la bozza; con buildId ripubblica una build dello storico (rollback).
const publishSchema = z.object({ buildId: z.number().int().positive().optional() });

export const action = ({ request, params }: Route.ActionArgs) =>
  handle(request, async () => {
    if (request.method !== "POST") methodNotAllowed();
    await authenticate(request, "admin");
    const text = await request.text();
    let body: unknown = {};
    try {
      if (text.trim()) body = JSON.parse(text);
    } catch {
      throw new ApiError(400, "Body JSON non valido.");
    }
    const input = publishSchema.safeParse(body);
    if (!input.success) throw new ApiError(400, "Dati non validi.", z.flattenError(input.error).fieldErrors);
    return { publishedBuildId: await publishTheme(params.name, input.data.buildId) };
  });
