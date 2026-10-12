import { methodNotAllowed } from "~/.server/api";
import { authenticate, handle, intParam, langParam } from "~/.server/api";
import { publicNode } from "~/.server/api-public";
import { getSiteLanguages } from "~/.server/languages";
import type { Route } from "./+types/node";

export const loader = ({ request, params }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "read");
    const { codes, defaultLang } = await getSiteLanguages();
    return publicNode(intParam(params.id), langParam(new URL(request.url), codes, defaultLang), defaultLang);
  });

export const action = ({ request }: Route.ActionArgs) => handle(request, async () => methodNotAllowed());
