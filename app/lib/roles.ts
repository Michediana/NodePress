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
  | "analytics" // statistiche del sito
  | "users"
  | "apikeys"
  | "themes" // temi: attivazione ed eliminazione
  | "themes.code" // temi: codice, creazione, import/export, CLI
  | "themes.customize"; // temi: editor visuale (composizione, token, CSS di override) e pubblicazione

/** Capacità aggiuntive assegnabili a un utente, oltre a quelle del ruolo. */
export type Capabilities = { themeDeveloper?: boolean };

/** Chi viene controllato: un ruolo, oppure un utente con le sue capacità. */
export type Subject = Role | ({ role: Role } & Capabilities);

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
    "analytics",
    "users",
    "apikeys",
    "themes",
    "themes.code",
    "themes.customize",
  ],
  editor: ["content.any", "content.own", "media", "media.upload", "themes.customize", "analytics"],
  author: ["content.own", "media.upload"],
};

/** "Sviluppatore tema": modifica il codice dei temi, anche dalla CLI. */
const themeDeveloperPermissions: Permission[] = ["themes.code", "themes.customize"];

export function can(subject: Subject, permission: Permission) {
  const user = typeof subject === "string" ? { role: subject } : subject;
  if (permissions[user.role].includes(permission)) return true;
  return Boolean(user.themeDeveloper && themeDeveloperPermissions.includes(permission));
}

export const roles: Role[] = ["admin", "editor", "author"];
