import { authenticate, handle, methodNotAllowed, readJson } from "~/.server/api";
import { maskedSettings, patchSettings, settingsPatchSchema } from "~/.server/api-admin";
import type { Route } from "./+types/settings";

export const loader = ({ request }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "admin");
    return maskedSettings();
  });

export const action = ({ request }: Route.ActionArgs) =>
  handle(request, async () => {
    if (request.method !== "PATCH") methodNotAllowed();
    await authenticate(request, "admin");
    return patchSettings(await readJson(request, settingsPatchSchema));
  });
