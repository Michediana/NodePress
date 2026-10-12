import { Outlet } from "react-router";
import "~/app.css";

/** Layout senza percorso che carica il CSS del pannello (Tailwind + shadcn): il front non lo eredita. */
export default function AdminStyles() {
  return <Outlet />;
}
