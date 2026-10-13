import { and, asc, eq, isNull } from "drizzle-orm";
import { authenticate, handle, json, methodNotAllowed, readJson } from "~/.server/api";
import { createNodeWithTranslations, nodeSchema } from "~/.server/api-admin";
import { pagination } from "~/.server/api-public";
import { db, schema } from "~/.server/db";
import type { Route } from "./+types/nodes";

export const loader = ({ request }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "admin");
    const url = new URL(request.url);
    const { page, perPage } = pagination(url);
    const type = url.searchParams.get("type");
    const parent = url.searchParams.get("parent");
    const conditions = [];
    if (type === "page" || type === "collection" || type === "item") conditions.push(eq(schema.nodes.type, type));
    if (parent) conditions.push(parent === "root" ? isNull(schema.nodes.parentId) : eq(schema.nodes.parentId, Number(parent)));
    const items = await db.query.nodes.findMany({
      where: conditions.length ? and(...conditions) : undefined,
      with: { translations: { columns: { content: false } } },
      orderBy: [asc(schema.nodes.parentId), asc(schema.nodes.sortOrder), asc(schema.nodes.id)],
      limit: perPage,
      offset: (page - 1) * perPage,
    });
    return { page, perPage, items };
  });

export const action = ({ request }: Route.ActionArgs) =>
  handle(request, async () => {
    if (request.method !== "POST") methodNotAllowed();
    const { user } = await authenticate(request, "admin");
    const input = await readJson(request, nodeSchema);
    return json(await createNodeWithTranslations(user?.id ?? null, input), 201);
  });
