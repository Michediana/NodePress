import { Link, useLocation } from "react-router";
import { t } from "~/admin/i18n";
import { Button } from "~/components/ui/button";

/** Paginazione semplice basata sul parametro `page` della query string. */
export function Pager({ page, total, perPage }: { page: number; total: number; perPage: number }) {
  const location = useLocation();
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const params = new URLSearchParams(location.search);
    params.set("page", String(p));
    return `${location.pathname}?${params}`;
  };
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground">{t("common.pageOf", { page, pages })}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} nativeButton={false} render={<Link to={href(page - 1)} />}>
          {t("common.previous")}
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} nativeButton={false} render={<Link to={href(page + 1)} />}>
          {t("common.next")}
        </Button>
      </div>
    </div>
  );
}

export function pageParam(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("page"));
  return Number.isInteger(value) && value > 0 ? value : 1;
}
