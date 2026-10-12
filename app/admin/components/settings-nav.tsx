import { Link, useLocation } from "react-router";
import { ImageIcon, LanguagesIcon, MailIcon, SearchIcon, SettingsIcon, ActivityIcon } from "lucide-react";
import { t } from "~/admin/i18n";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";

const links = [
  { to: "/admin/settings", label: "settings.general", icon: SettingsIcon },
  { to: "/admin/settings/languages", label: "settings.languages", icon: LanguagesIcon },
  { to: "/admin/settings/media", label: "settings.media", icon: ImageIcon },
  { to: "/admin/settings/seo", label: "settings.seo", icon: SearchIcon },
  { to: "/admin/settings/tracking", label: "settings.tracking", icon: ActivityIcon },
  { to: "/admin/settings/email", label: "settings.email", icon: MailIcon },
];

export function SettingsNav() {
  const { pathname } = useLocation();
  const current = pathname.replace(/\/+$/, "");
  const active = links.find((link) => link.to === current)?.to ?? links[0].to;

  return (
    <Tabs value={active}>
      <TabsList className="max-w-full overflow-x-auto">
        {links.map(({ to, label, icon: Icon }) => (
          <TabsTrigger key={to} value={to} render={<Link to={to} />} nativeButton={false}>
            <Icon data-icon="inline-start" />
            {t(label)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
