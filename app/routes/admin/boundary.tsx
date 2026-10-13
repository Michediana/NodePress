import { LayoutDashboardIcon } from "lucide-react";
import { isRouteErrorResponse, Link, Outlet } from "react-router";
import { t } from "~/admin/i18n";
import { Button } from "~/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import type { Route } from "./+types/boundary";

// Layout senza percorso: mantiene la sidebar visibile quando una pagina del pannello va in errore.
export default function Boundary() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = t("errors.generic");
  let description = t("errors.genericDescription");
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = t("errors.notFound");
      description = t("errors.notFoundDescription");
    } else if (error.status === 403) {
      title = t("errors.forbidden");
      description = typeof error.data === "string" ? error.data : t("errors.forbiddenDescription");
    } else if (typeof error.data === "string") {
      description = error.data;
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    description = error.message;
  }
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button nativeButton={false} render={<Link to="/admin" />}>
          <LayoutDashboardIcon data-icon="inline-start" />
          {t("nav.dashboard")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
