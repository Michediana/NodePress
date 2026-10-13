import { authenticate, handle } from "~/.server/api";
import { exportTheme } from "~/.server/theme/store";
import type { Route } from "./+types/theme-export";

/** Sorgenti del tema in uno zip, reimportabile con POST /themes. */
export const loader = ({ request, params }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "theme");
    const zip = await exportTheme(params.name);
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${params.name}.zip"`,
      },
    });
  });
