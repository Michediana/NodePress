import { z } from "zod";
import { authenticate, handle, json, methodNotAllowed, readJson } from "~/.server/api";
import { createMenu, getMenuWithItems, listMenus, updateMenu } from "~/.server/menus";
import type { Route } from "./+types/menus";

export const menuItemSchema = z.object({
  depth: z.number().int().min(0).max(5).default(0),
  nodeId: z.number().int().nullable().default(null),
  url: z.string().max(1000).nullable().default(null),
  newTab: z.boolean().default(false),
  labels: z.record(z.string(), z.string().max(255)).default({}),
});

export const menuSchema = z.object({
  name: z.string().trim().min(1).max(255),
  location: z.string().max(64).nullish(),
  items: z.array(menuItemSchema).optional(),
});

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
