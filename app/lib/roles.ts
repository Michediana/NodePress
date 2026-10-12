export type Role = "admin" | "editor" | "author";

export type Permission =
  | "content.any" // modifica qualsiasi contenuto
  | "content.own" // modifica i propri contenuti
  | "media" // gestione completa dei media
  | "media.upload" // caricamento media e uso nella libreria
  | "menus"
  | "redirects"
  | "languages"
  | "settings"
  | "users"
  | "apikeys";

const permissions: Record<Role, Permission[]> = {
  admin: [
    "content.any",
    "content.own",
    "media",
    "media.upload",
    "menus",
    "redirects",
    "languages",
    "settings",
    "users",
    "apikeys",
  ],
  editor: ["content.any", "content.own", "media", "media.upload"],
  author: ["content.own", "media.upload"],
};

export function can(role: Role, permission: Permission) {
  return permissions[role].includes(permission);
}

export const roles: Role[] = ["admin", "editor", "author"];
