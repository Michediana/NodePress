import { ApiError, handle } from "~/.server/api";
import type { Route } from "./+types/not-found";

const notFound = (request: Request) =>
  handle(request, async () => {
    throw new ApiError(404, "Endpoint non trovato.");
  });

export const loader = ({ request }: Route.LoaderArgs) => notFound(request);
export const action = ({ request }: Route.ActionArgs) => notFound(request);
