import { methodNotAllowed } from "~/.server/api";
import { ApiError, authenticate, handle, langParam } from "~/.server/api";
import { getSiteLanguages } from "~/.server/languages";
import { getFrontMenu } from "~/.server/menus";
import type { Route } from "./+types/menu";

export const loader = ({ request, params }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "read");
    const { codes, defaultLang } = await getSiteLanguages();
    const lang = langParam(new URL(request.url), codes, defaultLang);
    const menu = await getFrontMenu({ location: params.location }, lang, defaultLang);
    if (!menu) throw new ApiError(404, "Menu non trovato.");
    return { ...menu, lang };
  });

export const action = ({ request }: Route.ActionArgs) => handle(request, async () => methodNotAllowed());
