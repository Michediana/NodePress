import { methodNotAllowed } from "~/.server/api";
import { authenticate, handle, ApiError } from "~/.server/api";
import { loadPage } from "~/.server/front";
import type { Route } from "./+types/content";

// Risolve un URL pubblico (es. ?path=/en/news/news1) come farebbe il front.
export const loader = ({ request }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "read");
    const url = new URL(request.url);
    const path = url.searchParams.get("path");
    if (!path || !path.startsWith("/")) throw new ApiError(400, 'Parametro "path" mancante o non valido.');
    const target = new URL(path, url.origin);
    return loadPage(new Request(target));
  });

export const action = ({ request }: Route.ActionArgs) => handle(request, async () => methodNotAllowed());
