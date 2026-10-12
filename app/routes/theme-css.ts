import { getTheme } from "~/.server/theme";
import type { Route } from "./+types/theme-css";

/** CSS compilato del tema attivo. L'hash nel nome cambia a ogni modifica: cache immutabile. */
export async function loader({ params }: Route.LoaderArgs) {
  const theme = await getTheme();
  const current = params.file === `${theme.cssHash}.css`;
  return new Response(theme.css, {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      // Un hash vecchio riceve il CSS attuale, ma senza cache.
      "Cache-Control": current ? "public, max-age=31536000, immutable" : "no-cache",
    },
  });
}
