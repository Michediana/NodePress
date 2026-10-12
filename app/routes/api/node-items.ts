import { methodNotAllowed } from "~/.server/api";
import { authenticate, handle, intParam, langParam } from "~/.server/api";
import { pagination, publicNodeList } from "~/.server/api-public";
import { getSiteLanguages } from "~/.server/languages";
import type { Route } from "./+types/node-items";

export const loader = ({ request, params }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "read");
    const url = new URL(request.url);
    const { codes, defaultLang } = await getSiteLanguages();
    return publicNodeList({
      lang: langParam(url, codes, defaultLang),
      defaultLang,
      type: "item",
      parentId: intParam(params.id),
      ...pagination(url),
    });
  });

export const action = ({ request }: Route.ActionArgs) => handle(request, async () => methodNotAllowed());
