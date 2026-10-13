import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { count } from "drizzle-orm";
import { z } from "zod";
import { languageName, normalizeLangCode } from "~/lib/languages";
import {
  maskedSettings,
  menuItemSchema,
  menuSchema,
  patchSettings,
  redirectSchema,
  settingsPatchSchema,
} from "../api-admin";
import { db, schema } from "../db";
import { UserError } from "../forms";
import { addLanguage, getLanguages, getSiteLanguages, removeLanguage, setDefaultLanguage } from "../languages";
import { createMenu, deleteMenu, getMenuWithItems, listMenus, updateMenu } from "../menus";
import { createRedirect, deleteRedirect, listRedirects, updateRedirect } from "../redirects";
import { getSettings } from "../settings";
import { getActiveBuild, getTemplateOptions } from "../theme";
import { createUser, deleteUser, getUserById, listUsers, updateUser, userInputSchema } from "../users";
import { addTool, type McpContext } from "./tools";

/** Gli errori delle lingue sono Error semplici: diventano errori mostrabili. */
const userErrors = <T>(promise: Promise<T>) =>
  promise.catch((error: Error) => {
    throw new UserError(error.message);
  });

async function findMenu(id: number) {
  const menu = await getMenuWithItems(id);
  if (!menu) throw new UserError("Menu non trovato.", 404);
  return menu;
}

export function registerSiteInfoTool(server: McpServer, ctx: McpContext) {
  addTool(
    server,
    "site_info",
    {
      title: "Panoramica del sito",
      description:
        "Punto di partenza: nome e URL del sito, lingue, tema attivo con i template assegnabili ai nodi e le sezioni disponibili, menu, numero di contenuti e permessi della API key in uso.",
      readOnly: true,
    },
    async () => {
      const [settings, { codes, defaultLang }, templates, build] = await Promise.all([
        getSettings(["siteName", "siteUrl", "activeTheme"]),
        getSiteLanguages(),
        getTemplateOptions(),
        getActiveBuild(),
      ]);
      const info: Record<string, unknown> = {
        siteName: settings.siteName,
        siteUrl: settings.siteUrl || ctx.origin,
        languages: codes.map((code) => ({ code, name: languageName(code), default: code === defaultLang })),
        activeTheme: settings.activeTheme,
        templates: templates.templates,
        defaultTemplates: templates.defaults,
        sections: Object.values(build.schemas).map((s) => ({
          type: s.name,
          label: s.label,
          description: s.description,
          inContent: s.inContent,
        })),
        access: {
          scope: ctx.scope,
          user: ctx.user ? { id: ctx.user.id, name: ctx.user.name } : null,
          note:
            ctx.scope === "admin"
              ? "Accesso completo: contenuti, media, menu, redirect, lingue, impostazioni, utenti e temi."
              : "Solo temi: codice, bozze, pubblicazione e anteprime. Non può attivare né eliminare temi.",
        },
      };
      if (ctx.scope === "admin") {
        const [byType, menus] = await Promise.all([
          db.select({ type: schema.nodes.type, n: count() }).from(schema.nodes).groupBy(schema.nodes.type),
          listMenus(),
        ]);
        info.contentCounts = Object.fromEntries(byType.map((r) => [r.type, Number(r.n)]));
        info.menus = menus.map((m) => ({ id: m.id, name: m.name, location: m.location }));
      }
      return info;
    },
  );
}

export function registerSiteTools(server: McpServer, ctx: McpContext) {
  // --- Menu ---

  addTool(
    server,
    "menus_list",
    {
      title: "Menu",
      description: "Menu del sito con la posizione (header, footer…) che i template leggono.",
      readOnly: true,
    },
    async () => listMenus(),
  );

  addTool(
    server,
    "menu_get",
    {
      title: "Leggi un menu",
      description:
        "Voci di un menu come lista piatta in ordine di visita: depth indica il livello (0 = primo livello), nodeId o url la destinazione, labels le etichette per lingua (vuote = titolo del contenuto).",
      readOnly: true,
      input: { id: z.number().int() },
    },
    async ({ id }) => findMenu(id),
  );

  addTool(
    server,
    "menu_save",
    {
      title: "Crea o modifica un menu",
      description:
        "Senza id crea un menu, con id lo aggiorna. Se passi items, sostituiscono tutte le voci esistenti (leggi prima il menu con menu_get). Una voce punta a un contenuto (nodeId, mostrato solo nelle lingue in cui è tradotto) o a un URL; depth crea i sottomenu.",
      input: {
        id: z.number().int().optional(),
        name: menuSchema.shape.name,
        location: menuSchema.shape.location.describe(
          "Posizione letta dai template, es. header o footer; null = nessuna.",
        ),
        items: z.array(menuItemSchema).optional(),
      },
    },
    async ({ id, ...input }) => {
      if (id) {
        await findMenu(id);
        await updateMenu(id, input);
        return findMenu(id);
      }
      const created = await createMenu(input.name, input.location);
      if (input.items) await updateMenu(created, input);
      return findMenu(created);
    },
  );

  addTool(
    server,
    "menu_delete",
    {
      title: "Elimina un menu",
      description: "Elimina un menu con tutte le voci.",
      destructive: true,
      input: { id: z.number().int() },
    },
    async ({ id }) => {
      await findMenu(id);
      await deleteMenu(id);
      return { ok: true };
    },
  );

  // --- Redirect ---

  addTool(
    server,
    "redirects_list",
    {
      title: "Redirect",
      description: "Redirect del sito, manuali e automatici (creati quando cambia uno slug).",
      readOnly: true,
      input: {
        q: z.string().optional(),
        page: z.number().int().min(1).default(1),
        perPage: z.number().int().min(1).max(500).default(50),
      },
    },
    async (args) => ({ page: args.page, perPage: args.perPage, ...(await listRedirects(args)) }),
  );

  addTool(
    server,
    "redirect_create",
    {
      title: "Crea un redirect",
      description:
        "Redirect da un percorso del sito (es. /vecchia-pagina) a un percorso o a un URL esterno. Codici: 301, 302, 307, 308.",
      input: redirectSchema.shape,
    },
    async (input) => ({ id: await createRedirect(input) }),
  );

  addTool(
    server,
    "redirect_update",
    {
      title: "Modifica un redirect",
      description: "Cambia destinazione e codice di un redirect.",
      input: { id: z.number().int(), toPath: redirectSchema.shape.toPath, statusCode: redirectSchema.shape.statusCode },
    },
    async ({ id, ...input }) => {
      await updateRedirect(id, input);
      return { ok: true };
    },
  );

  addTool(
    server,
    "redirect_delete",
    {
      title: "Elimina un redirect",
      description: "Elimina un redirect.",
      destructive: true,
      input: { id: z.number().int() },
    },
    async ({ id }) => {
      await deleteRedirect(id);
      return { ok: true };
    },
  );

  // --- Lingue ---

  addTool(
    server,
    "languages_list",
    {
      title: "Lingue",
      description: "Lingue attive del sito; quella di default non ha prefisso negli URL.",
      readOnly: true,
    },
    async () => (await getLanguages()).map((l) => ({ code: l.code, name: languageName(l.code), default: l.isDefault })),
  );

  addTool(
    server,
    "language_add",
    {
      title: "Attiva una lingua",
      description:
        "Attiva una lingua (codice ISO 639-1, con variante regionale facoltativa, es. en o pt-BR). I contenuti vanno poi tradotti uno per uno.",
      input: { code: z.string() },
    },
    async ({ code }) => {
      const normalized = normalizeLangCode(code);
      if (!normalized) throw new UserError("Codice lingua non valido.");
      await addLanguage(normalized);
      return { ok: true, code: normalized };
    },
  );

  addTool(
    server,
    "language_remove",
    {
      title: "Disattiva una lingua",
      description:
        "Disattiva una lingua ed elimina tutte le traduzioni dei contenuti e dei menu in quella lingua. Chiedi conferma all'utente prima di usarlo.",
      destructive: true,
      input: { code: z.string() },
    },
    async ({ code }) => {
      await userErrors(removeLanguage(code));
      return { ok: true };
    },
  );

  addTool(
    server,
    "language_set_default",
    {
      title: "Lingua di default",
      description:
        "Imposta la lingua di default: i suoi URL perdono il prefisso, quelli della precedente lo acquistano.",
      input: { code: z.string() },
    },
    async ({ code }) => {
      await userErrors(setDefaultLanguage(code));
      return { ok: true };
    },
  );

  // --- Impostazioni ---

  addTool(
    server,
    "settings_get",
    {
      title: "Impostazioni",
      description:
        "Impostazioni del sito: nome e URL, API pubblica, formato e qualità delle immagini, robots.txt e llms.txt (null = generati), tracking (GA4, GTM, Clarity), testi del banner cookie per lingua, SMTP (password mascherata), CSP.",
      readOnly: true,
    },
    async () => maskedSettings(),
  );

  addTool(
    server,
    "settings_update",
    {
      title: "Modifica le impostazioni",
      description:
        'Aggiorna solo le impostazioni passate. smtp va passato intero; per lasciare la password invariata usa "********".',
      input: settingsPatchSchema.shape,
    },
    async (input) => patchSettings(input),
  );

  // --- Utenti ---

  addTool(
    server,
    "users_list",
    {
      title: "Utenti",
      description: 'Utenti del pannello con ruolo (admin, editor, author) e capability "Sviluppatore tema".',
      readOnly: true,
    },
    async () => listUsers(),
  );

  addTool(
    server,
    "user_create",
    {
      title: "Crea un utente",
      description:
        "Crea un utente del pannello. Ruoli: admin (tutto), editor (contenuti, media, editor visuale), author (solo i propri contenuti).",
      input: { ...userInputSchema.shape, password: z.string().min(8).max(200) },
    },
    async (input) => getUserById(await createUser(input)),
  );

  addTool(
    server,
    "user_update",
    {
      title: "Modifica un utente",
      description: "Aggiorna i campi passati. Cambiare la password chiude le sessioni dell'utente.",
      input: {
        id: z.number().int(),
        name: userInputSchema.shape.name.optional(),
        email: userInputSchema.shape.email.optional(),
        role: userInputSchema.shape.role.optional(),
        password: z.string().min(8).max(200).optional(),
        themeDeveloper: z.boolean().optional(),
      },
    },
    async ({ id, ...input }) => {
      const current = await getUserById(id);
      if (!current) throw new UserError("Utente non trovato.", 404);
      await updateUser(id, {
        name: input.name ?? current.name,
        email: input.email ?? current.email,
        role: input.role ?? current.role,
        password: input.password,
        themeDeveloper: input.themeDeveloper ?? current.themeDeveloper,
      });
      return getUserById(id);
    },
  );

  addTool(
    server,
    "user_delete",
    {
      title: "Elimina un utente",
      description:
        "Elimina un utente; i suoi contenuti restano senza autore. Chiedi conferma all'utente prima di usarlo.",
      destructive: true,
      input: { id: z.number().int() },
    },
    async ({ id }) => {
      if (!(await getUserById(id))) throw new UserError("Utente non trovato.", 404);
      await deleteUser(id, ctx.user?.id ?? 0);
      return { ok: true };
    },
  );
}
