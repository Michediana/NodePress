import { authenticate, handle, json, methodNotAllowed, readJson } from "~/.server/api";
import { menuSchema } from "~/.server/api-admin";
import { createMenu, getMenuWithItems, listMenus, updateMenu } from "~/.server/menus";
import type { Route } from "./+types/menus";

export const loader = ({ request }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "admin");
    return { items: await listMenus() };
  });

export const action = ({ request }: Route.ActionArgs) =>
  handle(request, async () => {
    if (request.method !== "POST") methodNotAllowed();
    await authenticate(request, "admin");
    const input = await readJson(request, menuSchema);
    const id = await createMenu(input.name, input.location);
    if (input.items) await updateMenu(id, input);
    return json(await getMenuWithItems(id), 201);
  });
