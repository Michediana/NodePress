import { Link } from "react-router";
import { cn } from "~/lib/utils";
import { useMenu, type FrontMenuItem } from "./site";

function MenuLink({ item, className }: { item: FrontMenuItem; className?: string }) {
  const props = item.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {};
  return item.external ? (
    <a href={item.href} className={className} {...props}>
      {item.label}
    </a>
  ) : (
    <Link to={item.href} className={className} {...props}>
      {item.label}
    </Link>
  );
}

/** Menu di una posizione, con sottomenu annidati. */
export function Menu({ location, className }: { location: string; className?: string }) {
  const items = useMenu(location);
  if (!items.length) return null;
  const render = (list: FrontMenuItem[], depth: number) => (
    <ul className={cn(depth === 0 ? cn("flex flex-wrap gap-x-6 gap-y-2", className) : "mt-2 flex flex-col gap-2 pl-4 text-sm")}>
      {list.map((item, i) => (
        <li key={i}>
          <MenuLink item={item} className="text-muted-foreground transition-colors hover:text-foreground" />
          {item.children.length > 0 && render(item.children, depth + 1)}
        </li>
      ))}
    </ul>
  );
  return <nav aria-label={location}>{render(items, 0)}</nav>;
}
