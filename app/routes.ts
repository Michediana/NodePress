import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  // --- Pannello di amministrazione ---
  layout("routes/admin/styles.tsx", [
    route("admin/setup", "routes/admin/setup.tsx"),
    route("admin/login", "routes/admin/login.tsx"),
    route("admin/logout", "routes/admin/logout.tsx"),
    route("admin/forgot-password", "routes/admin/forgot-password.tsx"),
    route("admin/reset-password/:token", "routes/admin/reset-password.tsx"),
    route("admin/oauth/authorize", "routes/admin/oauth-authorize.tsx"),
    route("admin", "routes/admin/layout.tsx", [
      layout("routes/admin/boundary.tsx", [
        index("routes/admin/dashboard.tsx"),
        route("profile", "routes/admin/profile.tsx"),
        ...prefix("content", [
          index("routes/admin/content/tree.tsx"),
          route("new", "routes/admin/content/new.tsx"),
          route(":id", "routes/admin/content/edit.tsx"),
          route(":id/items", "routes/admin/content/items.tsx"),
        ]),
        ...prefix("media", [
          index("routes/admin/media/library.tsx"),
          route(":id", "routes/admin/media/detail.tsx"),
          route("picker", "routes/admin/media/picker.tsx"),
        ]),
        ...prefix("menus", [index("routes/admin/menus/list.tsx"), route(":id", "routes/admin/menus/edit.tsx")]),
        route("redirects", "routes/admin/redirects.tsx"),
        ...prefix("users", [index("routes/admin/users/list.tsx"), route(":id", "routes/admin/users/edit.tsx")]),
        route("api-keys", "routes/admin/api-keys.tsx"),
        route("analytics", "routes/admin/analytics.tsx"),
    ...prefix("appearance", [
      index("routes/admin/appearance/list.tsx"),
      route(":name", "routes/admin/appearance/editor.tsx"),
      route(":name/api", "routes/admin/appearance/api.ts"),
      route(":name/customize", "routes/admin/appearance/customize.tsx"),
    ]),
        ...prefix("settings", [
          index("routes/admin/settings/general.tsx"),
          route("languages", "routes/admin/settings/languages.tsx"),
          route("media", "routes/admin/settings/media.tsx"),
          route("seo", "routes/admin/settings/seo.tsx"),
          route("tracking", "routes/admin/settings/tracking.tsx"),
          route("email", "routes/admin/settings/email.tsx"),
        ]),
        route("*", "routes/admin/not-found.tsx"),
      ]),
    ]),
  ]),

  // --- API REST ---
  ...prefix("api/v1", [
    route("languages", "routes/api/languages.ts"),
    route("content", "routes/api/content.ts"),
    route("nodes", "routes/api/nodes.ts"),
    route("nodes/:id", "routes/api/node.ts"),
    route("nodes/:id/items", "routes/api/node-items.ts"),
    route("menus/:location", "routes/api/menu.ts"),
    ...prefix("admin", [
      route("nodes", "routes/api/admin/nodes.ts"),
      route("nodes/:id", "routes/api/admin/node.ts"),
      route("nodes/:id/translations/:lang", "routes/api/admin/translation.ts"),
      route("media", "routes/api/admin/media.ts"),
      route("media/:id", "routes/api/admin/media-item.ts"),
      route("menus", "routes/api/admin/menus.ts"),
      route("menus/:id", "routes/api/admin/menu.ts"),
      route("redirects", "routes/api/admin/redirects.ts"),
      route("redirects/:id", "routes/api/admin/redirect.ts"),
      route("languages", "routes/api/admin/languages.ts"),
      route("settings", "routes/api/admin/settings.ts"),
      route("users", "routes/api/admin/users.ts"),
      route("themes", "routes/api/admin/themes.ts"),
      route("themes/:name", "routes/api/admin/theme.ts"),
      route("themes/:name/files/*", "routes/api/admin/theme-files.ts"),
      route("themes/:name/publish", "routes/api/admin/theme-publish.ts"),
      route("themes/:name/export", "routes/api/admin/theme-export.ts"),
    ]),
    route("*", "routes/api/not-found.ts"),
  ]),

  // --- Server MCP per gli assistenti AI, con OAuth ---
  route("mcp", "routes/mcp.ts"),
  route(".well-known/oauth-protected-resource/*", "routes/oauth/protected-resource.ts"),
  route(".well-known/oauth-authorization-server/*", "routes/oauth/server-metadata.ts"),
  route("oauth/register", "routes/oauth/register.ts"),
  route("oauth/token", "routes/oauth/token.ts"),
  route("oauth/revoke", "routes/oauth/revoke.ts"),

  // --- File generati e media ---
  route("sitemap.xml", "routes/seo/sitemap.ts"),
  route("robots.txt", "routes/seo/robots.ts"),
  route("llms.txt", "routes/seo/llms.ts"),
  route("uploads/*", "routes/media-file.ts"),
  route("_np/theme/a/:file", "routes/theme-asset.ts"),
  route("_np/a", "routes/analytics-collect.ts"),

  // --- Front: tutte le altre rotte ---
  layout("routes/front/layout.tsx", [
    index("routes/front/page.tsx", { id: "routes/front/home" }),
    route("*", "routes/front/page.tsx"),
  ]),
] satisfies RouteConfig;
