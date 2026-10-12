import { NavLink } from "react-router";
import { t } from "~/admin/i18n";
import { cn } from "~/lib/utils";

const links = [
  { to: "/admin/settings", label: "settings.general", end: true },
  { to: "/admin/settings/languages", label: "settings.languages" },
  { to: "/admin/settings/media", label: "settings.media" },
  { to: "/admin/settings/seo", label: "settings.seo" },
  { to: "/admin/settings/tracking", label: "settings.tracking" },
  { to: "/admin/settings/email", label: "settings.email" },
];

export function SettingsNav() {
  return (
    <nav className="flex flex-wrap gap-1 border-b">
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end}
          className={({ isActive }) =>
            cn(
              "-mb-px border-b-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground",
              isActive ? "border-primary text-foreground" : "border-transparent",
            )
          }
        >
          {t(link.label)}
        </NavLink>
      ))}
    </nav>
  );
}
