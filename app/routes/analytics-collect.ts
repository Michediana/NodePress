import { collect } from "~/.server/analytics";
import type { Route } from "./+types/analytics-collect";

const headers = { "Cache-Control": "no-store" };

/** Riceve i dati delle analytics interne dal front (sendBeacon/fetch, stessa origine). */
export async function action({ request }: Route.ActionArgs) {
  return new Response(null, { status: await collect(request), headers });
}

export function loader() {
  return new Response(null, { status: 405, headers });
}
