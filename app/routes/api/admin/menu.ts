import { ApiError, authenticate, handle, intParam, methodNotAllowed, readJson } from "~/.server/api";
import { deleteMenu, getMenuWithItems, updateMenu } from "~/.server/menus";
import { menuSchema } from "./menus";
import type { Route } from "./+types/menu";

async function find(id: string | undefined) {
  const menu = await getMenuWithItems(intParam(id));
  if (!menu) throw new ApiError(404, "Menu non trovato.");
  return menu;
}

export const loader = ({ request, params }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "admin");
    return find(params.id);
  });

export const action = ({ request, params }: Route.ActionArgs) =>
  handle(request, async () => {
    await authenticate(request, "admin");
    const { menu } = await find(params.id);
    if (request.method === "DELETE") {
      await deleteMenu(menu.id);
      return { ok: true };
    }
    if (request.method !== "PUT") methodNotAllowed();
    await updateMenu(menu.id, await readJson(request, menuSchema));
    return find(params.id);
  });
