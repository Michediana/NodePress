import { authenticate, handle, json, methodNotAllowed, readJson } from "~/.server/api";
import { createUser, getUserById, listUsers, userInputSchema } from "~/.server/users";
import type { Route } from "./+types/users";

export const loader = ({ request }: Route.LoaderArgs) =>
  handle(request, async () => {
    await authenticate(request, "admin");
    return { items: await listUsers() };
  });

export const action = ({ request }: Route.ActionArgs) =>
  handle(request, async () => {
    if (request.method !== "POST") methodNotAllowed();
    await authenticate(request, "admin");
    const id = await createUser(await readJson(request, userInputSchema));
    return json(await getUserById(id), 201);
  });
