import { relations, sql } from "drizzle-orm";
import {
  boolean,
  customType,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
  type AnyMySqlColumn,
} from "drizzle-orm/mysql-core";
import type { ContentDoc } from "~/lib/content";
import type { MediaVariant } from "~/lib/media";
import type { ThemeBuildData } from "~/lib/theme/manifest";

const now = () => datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`);
const updated = () =>
  datetime("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdate(() => new Date());

// --- Utenti e autenticazione ---

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["admin", "editor", "author"]).notNull().default("author"),
  /** Capability "Sviluppatore tema": codice dei temi e CLI anche senza essere admin. */
  themeDeveloper: boolean("theme_developer").notNull().default(false),
  createdAt: now(),
  updatedAt: updated(),
});

export const sessions = mysqlTable(
  "sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(), // hash sha256 del token
    userId: int("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: datetime("expires_at").notNull(),
    createdAt: now(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const passwordResets = mysqlTable("password_resets", {
  id: varchar("id", { length: 64 }).primaryKey(), // hash sha256 del token
  userId: int("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: datetime("expires_at").notNull(),
  usedAt: datetime("used_at"),
  createdAt: now(),
});

export const apiKeys = mysqlTable("api_keys", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  prefix: varchar("prefix", { length: 16 }).notNull(),
  keyHash: varchar("key_hash", { length: 64 }).notNull().unique(),
  scope: mysqlEnum("scope", ["read", "admin", "theme"]).notNull(),
  createdBy: int("created_by").references(() => users.id, { onDelete: "set null" }),
  lastUsedAt: datetime("last_used_at"),
  createdAt: now(),
});

// --- OAuth (server MCP) ---

/** Client OAuth: registrati con la registrazione dinamica o letti da un Client ID Metadata Document. */
export const oauthClients = mysqlTable("oauth_clients", {
  id: int("id").autoincrement().primaryKey(),
  /** client_id: casuale (`npc_…`) o l'URL del metadata document. */
  clientId: varchar("client_id", { length: 700 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  clientUri: varchar("client_uri", { length: 1000 }),
  redirectUris: json("redirect_uris").$type<string[]>().notNull(),
  /** true se il client_id è un URL e i metadati vanno riletti da lì. */
  metadataDocument: boolean("metadata_document").notNull().default(false),
  fetchedAt: datetime("fetched_at"),
  lastUsedAt: datetime("last_used_at"),
  createdAt: now(),
});

/** Codici di autorizzazione: monouso, validi un minuto, legati a PKCE, redirect_uri e risorsa. */
export const oauthCodes = mysqlTable("oauth_codes", {
  id: varchar("id", { length: 64 }).primaryKey(), // hash sha256 del codice
  clientId: int("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  userId: int("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  scope: mysqlEnum("scope", ["admin", "theme"]).notNull(),
  redirectUri: varchar("redirect_uri", { length: 1000 }).notNull(),
  codeChallenge: varchar("code_challenge", { length: 128 }).notNull(),
  resource: varchar("resource", { length: 1000 }).notNull(),
  expiresAt: datetime("expires_at").notNull(),
  createdAt: now(),
});

/** Accesso concesso a un client: access token e refresh token correnti (solo hash), ruotati a ogni rinnovo. */
export const oauthGrants = mysqlTable(
  "oauth_grants",
  {
    id: int("id").autoincrement().primaryKey(),
    clientId: int("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    userId: int("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: mysqlEnum("scope", ["admin", "theme"]).notNull(),
    resource: varchar("resource", { length: 1000 }).notNull(),
    accessHash: varchar("access_hash", { length: 64 }).notNull().unique(),
    accessExpiresAt: datetime("access_expires_at").notNull(),
    refreshHash: varchar("refresh_hash", { length: 64 }).notNull().unique(),
    /** Refresh token precedente: se torna, è stato rubato e la concessione viene revocata. */
    previousRefreshHash: varchar("previous_refresh_hash", { length: 64 }),
    refreshExpiresAt: datetime("refresh_expires_at").notNull(),
    lastUsedAt: datetime("last_used_at"),
    createdAt: now(),
  },
  (t) => [index("oauth_grants_user_idx").on(t.userId), index("oauth_grants_prev_idx").on(t.previousRefreshHash)],
);

// --- Impostazioni e lingue ---

export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: json("value").notNull(),
});

export const languages = mysqlTable("languages", {
  code: varchar("code", { length: 16 }).primaryKey(),
  isDefault: boolean("is_default").notNull().default(false),
  sortOrder: int("sort_order").notNull().default(0),
});

// --- Albero delle rotte e contenuti ---

export const nodes = mysqlTable(
  "nodes",
  {
    id: int("id").autoincrement().primaryKey(),
    parentId: int("parent_id").references((): AnyMySqlColumn => nodes.id, {
      onDelete: "cascade",
    }),
    type: mysqlEnum("type", ["page", "collection", "item"]).notNull(),
    template: varchar("template", { length: 64 }).notNull(),
    itemTemplate: varchar("item_template", { length: 64 }),
    perPage: int("per_page").notNull().default(10),
    sortOrder: int("sort_order").notNull().default(0),
    authorId: int("author_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: now(),
    updatedAt: updated(),
  },
  (t) => [index("nodes_parent_idx").on(t.parentId)],
);

export const nodeTranslations = mysqlTable(
  "node_translations",
  {
    id: int("id").autoincrement().primaryKey(),
    nodeId: int("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    lang: varchar("lang", { length: 16 })
      .notNull()
      .references(() => languages.code, { onDelete: "cascade", onUpdate: "cascade" }),
    slug: varchar("slug", { length: 191 }).notNull(),
    // Percorso completo senza prefisso lingua, es. "/notizie/notizia1".
    path: varchar("path", { length: 700 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    excerpt: text("excerpt"),
    content: json("content").$type<ContentDoc>(),
    status: mysqlEnum("status", ["draft", "published", "scheduled"]).notNull().default("draft"),
    publishedAt: datetime("published_at"),
    seoTitle: varchar("seo_title", { length: 255 }),
    seoDescription: text("seo_description"),
    focusKeyword: varchar("focus_keyword", { length: 255 }),
    ogImageId: int("og_image_id").references(() => media.id, { onDelete: "set null" }),
    noindex: boolean("noindex").notNull().default(false),
    createdAt: now(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex("node_translations_node_lang_uq").on(t.nodeId, t.lang),
    uniqueIndex("node_translations_lang_path_uq").on(t.lang, t.path),
  ],
);

export const redirects = mysqlTable("redirects", {
  id: int("id").autoincrement().primaryKey(),
  // Percorsi completi, inclusivi del prefisso lingua.
  fromPath: varchar("from_path", { length: 700 }).notNull().unique(),
  toPath: varchar("to_path", { length: 1000 }).notNull(),
  statusCode: int("status_code").notNull().default(301),
  automatic: boolean("automatic").notNull().default(false),
  createdAt: now(),
});

// --- Media ---

// Cartelle virtuali della libreria: organizzano i media senza spostare i file su disco.
export const mediaFolders = mysqlTable(
  "media_folders",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    parentId: int("parent_id").references((): AnyMySqlColumn => mediaFolders.id, { onDelete: "cascade" }),
    createdBy: int("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: now(),
  },
  (t) => [index("media_folders_parent_idx").on(t.parentId)],
);

export const media = mysqlTable(
  "media",
  {
    id: int("id").autoincrement().primaryKey(),
    folderId: int("folder_id").references(() => mediaFolders.id, { onDelete: "set null" }),
    file: varchar("file", { length: 255 }).notNull(),
    originalName: varchar("original_name", { length: 255 }).notNull(),
    mime: varchar("mime", { length: 128 }).notNull(),
    size: int("size").notNull(),
    width: int("width"),
    height: int("height"),
    variants: json("variants").$type<MediaVariant[]>().notNull(),
    alt: json("alt").$type<Record<string, string>>().notNull(),
    uploadedBy: int("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: now(),
  },
  (t) => [index("media_folder_idx").on(t.folderId)],
);

// --- Menu ---

export const menus = mysqlTable("menus", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  location: varchar("location", { length: 64 }).unique(),
  createdAt: now(),
});

export const menuItems = mysqlTable(
  "menu_items",
  {
    id: int("id").autoincrement().primaryKey(),
    menuId: int("menu_id")
      .notNull()
      .references(() => menus.id, { onDelete: "cascade" }),
    parentId: int("parent_id").references((): AnyMySqlColumn => menuItems.id, {
      onDelete: "cascade",
    }),
    sortOrder: int("sort_order").notNull().default(0),
    nodeId: int("node_id").references(() => nodes.id, { onDelete: "cascade" }),
    url: varchar("url", { length: 1000 }),
    newTab: boolean("new_tab").notNull().default(false),
  },
  (t) => [index("menu_items_menu_idx").on(t.menuId)],
);

export const menuItemTranslations = mysqlTable(
  "menu_item_translations",
  {
    itemId: int("item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    lang: varchar("lang", { length: 16 })
      .notNull()
      .references(() => languages.code, { onDelete: "cascade", onUpdate: "cascade" }),
    label: varchar("label", { length: 255 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.lang] })],
);

// --- Temi ---

const longblob = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "longblob" });

/**
 * JSON salvato come testo: a differenza della colonna JSON di MySQL conserva l'ordine delle
 * chiavi, che nei temi conta (ordine delle impostazioni, dei template, dei token).
 */
const jsonText = <T>(name: string) =>
  customType<{ data: T; driverData: string }>({
    dataType: () => "longtext",
    toDriver: (value) => JSON.stringify(value),
    fromDriver: (value) => JSON.parse(value) as T,
  })(name);

export type ThemeBuildError = { message: string; file: string | null; line: number | null; column: number | null };

export const themes = mysqlTable("themes", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 64 }).notNull().unique(),
  label: varchar("label", { length: 255 }).notNull(),
  // Ultima build riuscita dei file attuali (bozza) e build visibile sul sito (pubblicata).
  draftBuildId: int("draft_build_id"),
  publishedBuildId: int("published_build_id"),
  // Errore dell'ultima compilazione: i file sono salvati, ma la bozza resta all'ultima build valida.
  buildError: json("build_error").$type<ThemeBuildError | null>(),
  createdAt: now(),
  updatedAt: updated(),
});

// Sorgenti del tema: markup, CSS, JS e asset (font, immagini), testo o binari.
export const themeFiles = mysqlTable(
  "theme_files",
  {
    themeId: int("theme_id")
      .notNull()
      .references(() => themes.id, { onDelete: "cascade" }),
    path: varchar("path", { length: 255 }).notNull(),
    content: longblob("content").notNull(),
    updatedAt: updated(),
  },
  (t) => [primaryKey({ columns: [t.themeId, t.path] })],
);

// Build immutabili: AST, manifest e riferimenti agli asset compilati.
export const themeBuilds = mysqlTable(
  "theme_builds",
  {
    id: int("id").autoincrement().primaryKey(),
    themeId: int("theme_id")
      .notNull()
      .references(() => themes.id, { onDelete: "cascade" }),
    data: jsonText<ThemeBuildData>("data").notNull(),
    // Valorizzato quando la build viene pubblicata: lo storico per il rollback.
    publishedAt: datetime("published_at"),
    createdBy: int("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: now(),
  },
  (t) => [index("theme_builds_theme_idx").on(t.themeId)],
);

// Asset compilati e statici indirizzati per hash: condivisi tra le build, cache immutabile.
export const themeAssets = mysqlTable("theme_assets", {
  hash: varchar("hash", { length: 64 }).primaryKey(),
  mime: varchar("mime", { length: 128 }).notNull(),
  content: longblob("content").notNull(),
  createdAt: now(),
});

// --- Relazioni ---

export const nodesRelations = relations(nodes, ({ one, many }) => ({
  parent: one(nodes, { fields: [nodes.parentId], references: [nodes.id], relationName: "tree" }),
  children: many(nodes, { relationName: "tree" }),
  translations: many(nodeTranslations),
  author: one(users, { fields: [nodes.authorId], references: [users.id] }),
}));

export const nodeTranslationsRelations = relations(nodeTranslations, ({ one }) => ({
  node: one(nodes, { fields: [nodeTranslations.nodeId], references: [nodes.id] }),
  ogImage: one(media, { fields: [nodeTranslations.ogImageId], references: [media.id] }),
}));

export const menusRelations = relations(menus, ({ many }) => ({
  items: many(menuItems),
}));

export const menuItemsRelations = relations(menuItems, ({ one, many }) => ({
  menu: one(menus, { fields: [menuItems.menuId], references: [menus.id] }),
  translations: many(menuItemTranslations),
}));

export const menuItemTranslationsRelations = relations(menuItemTranslations, ({ one }) => ({
  item: one(menuItems, { fields: [menuItemTranslations.itemId], references: [menuItems.id] }),
}));

export type User = typeof users.$inferSelect;
export type Role = User["role"];
export type Node = typeof nodes.$inferSelect;
export type NodeTranslation = typeof nodeTranslations.$inferSelect;
export type Media = typeof media.$inferSelect;
export type MediaFolder = typeof mediaFolders.$inferSelect;
export type Menu = typeof menus.$inferSelect;
export type MenuItem = typeof menuItems.$inferSelect;
export type Redirect = typeof redirects.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type OAuthClient = typeof oauthClients.$inferSelect;
export type OAuthGrant = typeof oauthGrants.$inferSelect;
