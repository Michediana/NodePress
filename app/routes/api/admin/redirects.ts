import { authenticate, handle, json, methodNotAllowed, readJson } from "~/.server/api";
import { redirectSchema } from "~/.server/api-admin";
import { pagination } from "~/.server/api-public";
import { createRedirect, listRedirects } from "~/.server/redirects";
import type { Route } from "./+types/redirects";

export const loader = ({ request }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "admin");
    const url = new URL(request.url);
    const { page, perPage } = pagination(url, 500);
    return { page, perPage, ...(await listRedirects({ page, perPage, q: url.searchParams.get("q") ?? "" })) };
  });

export const action = ({ request }: Route.ActionArgs) =>
  handle(request, async () => {
    if (request.method !== "POST") methodNotAllowed();
    await authenticate(request, "admin");
    const input = await readJson(request, redirectSchema);
    return json({ id: await createRedirect(input) }, 201);
  });
