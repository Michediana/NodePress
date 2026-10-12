import { Link } from "react-router";
import type { PageData } from "~/components/front/site";

export function Breadcrumbs({ items }: { items: PageData["breadcrumbs"] }) {
  if (items.length < 2) return null;
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, i) => (
          <li key={item.href} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden>/</span>}
            {i < items.length - 1 ? (
              <Link to={item.href} className="hover:text-foreground">
                {item.title}
              </Link>
            ) : (
              <span aria-current="page">{item.title}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
