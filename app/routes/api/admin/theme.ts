import { eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError, authenticate, handle, methodNotAllowed, readJson } from "~/.server/api";
import { db, schema } from "~/.server/db";
import { getSetting } from "~/.server/settings";
import { activateTheme, deleteTheme, listBuilds, listFiles, requireTheme } from "~/.server/theme/store";
import type { Route } from "./+types/theme";

const patchSchema = z.object({
  label: z.string().trim().min(1).max(255).optional(),
  active: z.literal(true).optional(),
});

async function detail(name: string) {
  const theme = await requireTheme(name);
  const [files, builds, active] = await Promise.all([
    listFiles(theme.id),
    listBuilds(theme.id),
    getSetting("activeTheme"),
  ]);
  return { ...theme, active: active === theme.name, files, builds };
}

export const loader = ({ request, params }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "theme");
    return detail(params.name);
  });

export const action = ({ request, params }: Route.ActionArgs) =>
  handle(request, async () => {
    const { scope } = await authenticate(request, "theme");
    // Eliminare e attivare un tema cambiano il sito: servono key admin, non theme.
    const requireAdmin = () => {
      if (scope !== "admin") throw new ApiError(403, "Serve una API key con scope admin.");
    };
    if (request.method === "DELETE") {
      requireAdmin();
      await deleteTheme(params.name);
      return { ok: true };
    }
    if (request.method !== "PATCH") methodNotAllowed();
    const input = await readJson(request, patchSchema);
    if (input.active) requireAdmin();
    const theme = await requireTheme(params.name);
    if (input.label) await db.update(schema.themes).set({ label: input.label }).where(eq(schema.themes.id, theme.id));
    if (input.active) await activateTheme(params.name);
    return detail(params.name);
  });
