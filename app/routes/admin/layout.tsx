import {
  FileTextIcon,
  ImageIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  SettingsIcon,
  SignpostIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { Form, Link, NavLink, Outlet, redirect, useLocation } from "react-router";
import { getSessionUser, needsSetup, userContext } from "~/.server/auth";
import { getSiteLanguages } from "~/.server/languages";
import { getSetting } from "~/.server/settings";
import { Logo } from "~/admin/components/logo";
import { t } from "~/admin/i18n";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "~/components/ui/sidebar";
import { Separator } from "~/components/ui/separator";
import { Toaster } from "~/components/ui/sonner";
import { TooltipProvider } from "~/components/ui/tooltip";
import { can, type Permission } from "~/lib/roles";
import type { Route } from "./+types/layout";

export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, context }) => {
    if (await needsSetup()) throw redirect("/admin/setup");
    const user = await getSessionUser(request);
    if (!user) {
      const url = new URL(request.url);
      const next = url.pathname + url.search;
      throw redirect(`/admin/login?next=${encodeURIComponent(next)}`);
    }
    context.set(userContext, user);
  },
];

export async function loader({ context }: Route.LoaderArgs) {
  const user = context.get(userContext)!;
  const [siteName, langs] = await Promise.all([getSetting("siteName"), getSiteLanguages()]);
  return { user, siteName, langs, lang: "it" };
}

export function meta() {
  return [{ title: t("app.adminTitle") }, { name: "robots", content: "noindex" }];
}

type NavEntry = { to: string; label: string; icon: React.ComponentType; permission?: Permission; end?: boolean };

const contentNav: NavEntry[] = [
  { to: "/admin", label: "nav.dashboard", icon: LayoutDashboardIcon, end: true },
  { to: "/admin/content", label: "nav.content", icon: FileTextIcon },
  { to: "/admin/media", label: "nav.media", icon: ImageIcon, permission: "media.upload" },
];

const siteNav: NavEntry[] = [
  { to: "/admin/menus", label: "nav.menus", icon: MenuIcon, permission: "menus" },
  { to: "/admin/redirects", label: "nav.redirects", icon: SignpostIcon, permission: "redirects" },
  { to: "/admin/users", label: "nav.users", icon: UsersIcon, permission: "users" },
  { to: "/admin/api-keys", label: "nav.apiKeys", icon: KeyRoundIcon, permission: "apikeys" },
  { to: "/admin/settings", label: "nav.settings", icon: SettingsIcon, permission: "settings" },
];

function NavGroup({ label, entries, role }: { label: string; entries: NavEntry[]; role: Route.ComponentProps["loaderData"]["user"]["role"] }) {
  const location = useLocation();
  const visible = entries.filter((e) => !e.permission || can(role, e.permission));
  if (!visible.length) return null;
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t(label)}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {visible.map((entry) => {
            const active = entry.end
              ? location.pathname === entry.to
              : location.pathname === entry.to || location.pathname.startsWith(entry.to + "/");
            const Icon = entry.icon;
            return (
              <SidebarMenuItem key={entry.to}>
                <SidebarMenuButton isActive={active} tooltip={t(entry.label)} render={<NavLink to={entry.to} end={entry.end} />}>
                  <Icon />
                  <span>{t(entry.label)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const { user, siteName } = loaderData;
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg" render={<Link to="/" target="_blank" />}>
                  <Logo className="size-8!" />
                  <div className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate font-medium">{siteName}</span>
                    <span className="truncate text-xs text-muted-foreground">{t("app.viewSite")}</span>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <NavGroup label="nav.groupContent" entries={contentNav} role={user.role} />
            <NavGroup label="nav.groupSite" entries={siteNav} role={user.role} />
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                    <Avatar className="size-8">
                      <AvatarFallback>{initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate font-medium">{user.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{t(`roles.${user.role}`)}</span>
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="start" className="min-w-56">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem render={<Link to="/admin/profile" />}>
                        <UserIcon />
                        {t("nav.profile")}
                      </DropdownMenuItem>
                      <Form method="post" action="/admin/logout">
                        <DropdownMenuItem render={<button type="submit" className="w-full" />}>
                          <LogOutIcon />
                          {t("nav.logout")}
                        </DropdownMenuItem>
                      </Form>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="h-4" />
            <span className="text-sm text-muted-foreground">{t("app.name")}</span>
          </header>
          <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
            <Outlet />
          </div>
        </SidebarInset>
        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  );
}
