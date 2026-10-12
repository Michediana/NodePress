import { methodNotAllowed } from "~/.server/api";
import { authenticate, handle } from "~/.server/api";
import { getSiteLanguages } from "~/.server/languages";
import { languageName } from "~/lib/languages";
import type { Route } from "./+types/languages";

export const loader = ({ request }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "read");
    const { codes, defaultLang } = await getSiteLanguages();
    return {
      default: defaultLang,
      languages: codes.map((code) => ({ code, name: languageName(code, code), isDefault: code === defaultLang, prefix: code === defaultLang ? "" : `/${code}` })),
    };
  });

export const action = ({ request }: Route.ActionArgs) => handle(request, async () => methodNotAllowed());
