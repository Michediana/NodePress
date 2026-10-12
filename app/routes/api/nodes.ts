import { methodNotAllowed } from "~/.server/api";
import { authenticate, handle } from "~/.server/api";
import { pagination, publicNodeList } from "~/.server/api-public";
import { langParam } from "~/.server/api";
import { getSiteLanguages } from "~/.server/languages";
import type { Route } from "./+types/nodes";

export const loader = ({ request }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "read");
    const url = new URL(request.url);
    const { codes, defaultLang } = await getSiteLanguages();
    const parent = url.searchParams.get("parent");
    return publicNodeList({
      lang: langParam(url, codes, defaultLang),
      defaultLang,
      type: url.searchParams.get("type"),
      parentId: parent === null ? undefined : parent === "root" ? null : Number(parent),
      ...pagination(url),
    });
  });

export const action = ({ request }: Route.ActionArgs) => handle(request, async () => methodNotAllowed());
