import { authenticate, handle, intParam, methodNotAllowed, readJson } from "~/.server/api";
import { adminNode, nodeUpdateSchema } from "~/.server/api-admin";
import { deleteNode, updateNode } from "~/.server/nodes";
import type { Route } from "./+types/node";

export const loader = ({ request, params }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "admin");
    return adminNode(intParam(params.id));
  });

export const action = ({ request, params }: Route.ActionArgs) =>
  handle(request, async () => {
    await authenticate(request, "admin");
    const id = intParam(params.id);
    const node = await adminNode(id);
    if (request.method === "DELETE") {
      await deleteNode(id);
      return { ok: true };
    }
    if (request.method !== "PATCH") methodNotAllowed();
    const input = await readJson(request, nodeUpdateSchema);
    await updateNode(id, {
      parentId: input.parentId === undefined ? node.parentId : input.parentId,
      template: input.template ?? node.template,
      itemTemplate: input.itemTemplate === undefined ? node.itemTemplate : input.itemTemplate,
      perPage: input.perPage ?? node.perPage,
    });
    return adminNode(id);
  });
