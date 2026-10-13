import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { z } from "zod";
import { t } from "~/admin/i18n";
import { walkDoc, type ContentDoc } from "~/lib/content";
import { localizedUrl } from "~/lib/languages";
import { analyzeSeo } from "~/lib/seo-score";
import { slugify } from "~/lib/slug";
import { effectiveStatus } from "~/lib/status";
import { adminNode, createNodeWithTranslations, translationSchema } from "../api-admin";
import { db, schema } from "../db";
import { resolveLang } from "../front";
import { UserError } from "../forms";
import { getSiteLanguages } from "../languages";
import { docToMarkdown, markdownToDoc } from "../markdown";
import { getMediaMany } from "../media";
import { deleteNode, deleteTranslation, getTree, moveNode, saveTranslation, updateNode, type TreeNode } from "../nodes";
import { findRedirect } from "../redirects";
import { getSetting } from "../settings";
import { addTool, defined, type McpContext } from "./tools";

const { nodes, nodeTranslations: tr } = schema;

const contentFormat = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("Formato del contenuto restituito: markdown (compatto, consigliato) o json (Tiptap).");

const contentInput = {
  markdown: z
    .string()
    .optional()
    .describe("Contenuto in Markdown (vedi guide topic=content). Alternativo a `content`."),
  content: translationSchema.shape.content.describe("Contenuto come documento Tiptap JSON. Alternativo a `markdown`."),
};

const translationFields = {
  title: z.string().trim().min(1).max(255).optional(),
  slug: z
    .string()
    .trim()
    .max(191)
    .optional()
    .describe('Lettere minuscole, numeri e trattini. Se manca, ricavato dal titolo. "" solo per la home.'),
  excerpt: z.string().max(5000).nullish().describe("Riassunto, usato negli elenchi e come fallback della description."),
  ...contentInput,
  status: z
    .enum(["draft", "published", "scheduled"])
    .optional()
    .describe("draft (default per le nuove traduzioni), published, scheduled (richiede publishedAt futura)."),
  publishedAt: z.iso
    .datetime({ offset: true })
    .nullish()
    .describe("Data di pubblicazione ISO 8601, es. 2026-10-13T09:00:00Z."),
  seoTitle: z.string().max(255).nullish(),
  seoDescription: z.string().max(1000).nullish(),
  focusKeyword: z.string().max(255).nullish().describe("Parola chiave per l'analisi SEO."),
  ogImageId: z.number().int().nullish().describe("Id del media usato come immagine social e di copertina."),
  noindex: z.boolean().optional(),
};

const newTranslationSchema = z.object({ ...translationFields, title: z.string().trim().min(1).max(255) });

/** Contenuto da salvare: il Markdown, se c'è, vince sul JSON. */
function resolveContent(input: { markdown?: string; content?: ContentDoc | null }) {
  if (input.markdown !== undefined) return markdownToDoc(input.markdown);
  return input.content;
}

async function siteBase(ctx: McpContext) {
  return (await getSetting("siteUrl")).trim().replace(/\/+$/, "") || ctx.origin;
}

/** Nodo con tutte le traduzioni, nel formato restituito ai client MCP. */
async function nodeView(ctx: McpContext, id: number, format: "markdown" | "json" | "none" = "markdown") {
  const node = await adminNode(id);
  const [{ defaultLang }, base] = await Promise.all([getSiteLanguages(), siteBase(ctx)]);
  return {
    id: node.id,
    type: node.type,
    parentId: node.parentId,
    template: node.template,
    itemTemplate: node.itemTemplate,
    perPage: node.perPage,
    sortOrder: node.sortOrder,
    authorId: node.authorId,
    updatedAt: node.updatedAt,
    translations: node.translations.map((x) => ({
      lang: x.lang,
      title: x.title,
      slug: x.slug,
      path: x.path,
      url: base + localizedUrl(x.path, x.lang, defaultLang),
      status: effectiveStatus(x.status, x.publishedAt),
      publishedAt: x.publishedAt,
      updatedAt: x.updatedAt,
      excerpt: x.excerpt,
      seoTitle: x.seoTitle,
      seoDescription: x.seoDescription,
      focusKeyword: x.focusKeyword,
      ogImageId: x.ogImageId,
      noindex: x.noindex,
      ...(format === "markdown"
        ? { markdown: docToMarkdown(x.content) }
        : format === "json"
          ? { content: x.content }
          : {}),
    })),
  };
}

function compactTree(list: TreeNode[]): unknown[] {
  return list.map((node) => ({
    id: node.id,
    type: node.type,
    template: node.template,
    ...(node.type === "collection" ? { itemTemplate: node.itemTemplate, itemCount: node.itemCount } : {}),
    translations: node.translations.map((x) => ({
      lang: x.lang,
      title: x.title,
      path: x.path,
      status: effectiveStatus(x.status, x.publishedAt),
    })),
    ...(node.children.length ? { children: compactTree(node.children) } : {}),
  }));
}

export function registerContentTools(server: McpServer, ctx: McpContext) {
  addTool(
    server,
    "content_tree",
    {
      title: "Albero dei contenuti",
      description:
        "Albero di pagine e raccoglitori, con le traduzioni (titolo, percorso, stato) e il numero di elementi di ogni raccoglitore. Gli elementi dei raccoglitori (es. articoli) non sono inclusi: usa content_list con parentId.",
      readOnly: true,
    },
    async () => compactTree(await getTree()),
  );

  addTool(
    server,
    "content_list",
    {
      title: "Cerca contenuti",
      description:
        "Elenco paginato di nodi con filtri. Per gli elementi di un raccoglitore usa parentId=<id del raccoglitore> e type=item. Il contenuto non è incluso: leggilo con content_get.",
      readOnly: true,
      input: {
        q: z.string().optional().describe("Testo da cercare nel titolo."),
        type: z.enum(["page", "collection", "item"]).optional(),
        parentId: z
          .union([z.number().int(), z.literal("root")])
          .optional()
          .describe('Id del genitore, o "root".'),
        lang: z.string().optional().describe("Solo nodi con una traduzione in questa lingua."),
        status: z.enum(["draft", "published", "scheduled"]).optional(),
        page: z.number().int().min(1).default(1),
        perPage: z.number().int().min(1).max(100).default(20),
      },
    },
    async (args) => {
      const conditions = [];
      if (args.type) conditions.push(eq(nodes.type, args.type));
      if (args.parentId !== undefined)
        conditions.push(args.parentId === "root" ? isNull(nodes.parentId) : eq(nodes.parentId, args.parentId));
      const trConditions = [];
      if (args.q) trConditions.push(like(tr.title, `%${args.q}%`));
      if (args.lang) trConditions.push(eq(tr.lang, args.lang));
      if (args.status) trConditions.push(eq(tr.status, args.status));
      if (trConditions.length)
        conditions.push(
          inArray(
            nodes.id,
            db
              .select({ id: tr.nodeId })
              .from(tr)
              .where(and(...trConditions)),
          ),
        );
      const where = conditions.length ? and(...conditions) : undefined;
      const [{ total }] = await db
        .select({ total: sql<number>`count(*)` })
        .from(nodes)
        .where(where);
      const rows = await db.query.nodes.findMany({
        where,
        with: { translations: { columns: { lang: true, title: true, path: true, status: true, publishedAt: true } } },
        orderBy:
          args.type === "item"
            ? [desc(nodes.createdAt), desc(nodes.id)]
            : [asc(nodes.parentId), asc(nodes.sortOrder), asc(nodes.id)],
        limit: args.perPage,
        offset: (args.page - 1) * args.perPage,
      });
      return {
        page: args.page,
        perPage: args.perPage,
        total: Number(total),
        items: rows.map((n) => ({
          id: n.id,
          type: n.type,
          parentId: n.parentId,
          template: n.template,
          translations: n.translations.map((x) => ({
            lang: x.lang,
            title: x.title,
            path: x.path,
            status: effectiveStatus(x.status, x.publishedAt),
            publishedAt: x.publishedAt,
          })),
        })),
      };
    },
  );

  addTool(
    server,
    "content_get",
    {
      title: "Leggi un contenuto",
      description: "Nodo con tutte le traduzioni (anche bozze): testi, SEO, stato, URL pubblico e contenuto.",
      readOnly: true,
      input: { id: z.number().int(), format: contentFormat },
    },
    async ({ id, format }) => nodeView(ctx, id, format),
  );

  addTool(
    server,
    "content_find_by_url",
    {
      title: "Trova un contenuto dall'URL",
      description:
        "Risolve un URL o un percorso pubblico del sito (es. https://sito.it/en/news/titolo o /chi-siamo) nel nodo e nella lingua corrispondenti, segnalando gli eventuali redirect.",
      readOnly: true,
      input: { url: z.string().min(1) },
    },
    async ({ url }) => {
      let pathname = url.trim();
      try {
        if (/^https?:\/\//.test(pathname)) pathname = new URL(pathname).pathname;
      } catch {
        throw new UserError("URL non valido.");
      }
      const redirect = await findRedirect(pathname);
      if (redirect)
        return { redirect: { from: redirect.fromPath, to: redirect.toPath, statusCode: redirect.statusCode } };
      const { lang, path } = await resolveLang(pathname);
      const [row] = await db
        .select({ id: tr.nodeId })
        .from(tr)
        .where(and(eq(tr.lang, lang), eq(tr.path, path === "/" ? "/" : path.replace(/\/+$/, ""))));
      if (!row) throw new UserError(`Nessun contenuto con percorso ${path} in "${lang}".`, 404);
      return { lang, node: await nodeView(ctx, row.id, "none") };
    },
  );

  addTool(
    server,
    "content_create",
    {
      title: "Crea un contenuto",
      description:
        "Crea una pagina, un raccoglitore o un elemento di un raccoglitore, con le traduzioni. Le pagine e i raccoglitori stanno alla radice o sotto una pagina; gli elementi sotto un raccoglitore (e ne ereditano il template). Il template di default dipende dal tipo: vedi site_info. Lo slug va tradotto per lingua; una traduzione può esistere solo se il genitore ha la stessa lingua.",
      input: {
        type: z.enum(["page", "collection", "item"]),
        parentId: z.number().int().nullable().default(null),
        template: z.string().optional().describe("Template del tema attivo per la pagina o l'elenco."),
        itemTemplate: z.string().optional().describe("Solo raccoglitori: template dei singoli elementi."),
        perPage: z.number().int().min(1).max(100).optional().describe("Solo raccoglitori: elementi per pagina."),
        translations: z
          .record(z.string(), newTranslationSchema)
          .describe("Traduzioni per codice lingua, es. { it: {…}, en: {…} }."),
      },
    },
    async ({ translations, ...node }) => {
      const prepared = Object.fromEntries(
        Object.entries(translations).map(([lang, input]) => {
          const { markdown: _markdown, ...rest } = input;
          return [
            lang,
            translationSchema.parse({
              ...rest,
              slug: input.slug ?? slugify(input.title),
              content: resolveContent(input),
            }),
          ];
        }),
      );
      const created = await createNodeWithTranslations(ctx.user?.id ?? null, { ...node, translations: prepared });
      return nodeView(ctx, created.id, "none");
    },
  );

  addTool(
    server,
    "content_save_translation",
    {
      title: "Scrivi una traduzione",
      description:
        "Crea o aggiorna la traduzione di un nodo in una lingua. Aggiornamento parziale: i campi omessi restano invariati (per una traduzione nuova servono almeno title). Cambiare lo slug sposta anche i figli e crea i redirect 301. Per pubblicare imposta status=published.",
      input: { id: z.number().int(), lang: z.string(), ...translationFields },
    },
    async ({ id, lang, markdown, content, ...fields }) => {
      const node = await adminNode(id);
      const current = node.translations.find((x) => x.lang === lang);
      if (!current && !fields.title) throw new UserError("Per una traduzione nuova serve il titolo.");
      const merged = {
        ...(current ?? { status: "draft" as const }),
        ...defined(fields),
        content:
          markdown !== undefined || content !== undefined ? resolveContent({ markdown, content }) : current?.content,
      };
      const title = merged.title!;
      const input = translationSchema.parse({ ...merged, slug: merged.slug ?? slugify(title) });
      await saveTranslation(id, lang, input);
      return nodeView(ctx, id, "none");
    },
  );

  addTool(
    server,
    "content_update",
    {
      title: "Modifica un nodo",
      description:
        "Cambia genitore (sposta il nodo con i figli, con redirect 301 automatici), template o impostazioni del raccoglitore. I testi si modificano con content_save_translation.",
      input: {
        id: z.number().int(),
        parentId: z.number().int().nullable().optional().describe("Nuovo genitore; null = radice."),
        template: z.string().optional(),
        itemTemplate: z.string().optional(),
        perPage: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ id, ...input }) => {
      const node = await adminNode(id);
      await updateNode(id, {
        parentId: input.parentId === undefined ? node.parentId : input.parentId,
        template: input.template ?? node.template,
        itemTemplate: input.itemTemplate ?? node.itemTemplate,
        perPage: input.perPage ?? node.perPage,
      });
      return nodeView(ctx, id, "none");
    },
  );

  addTool(
    server,
    "content_reorder",
    {
      title: "Riordina un nodo",
      description: "Sposta un nodo di una posizione tra i fratelli (ordine nell'albero e nei menu automatici).",
      input: { id: z.number().int(), direction: z.enum(["up", "down"]) },
    },
    async ({ id, direction }) => {
      await adminNode(id);
      await moveNode(id, direction);
      return { ok: true };
    },
  );

  addTool(
    server,
    "content_delete_translation",
    {
      title: "Elimina una traduzione",
      description:
        "Elimina la traduzione di un nodo in una lingua. Prima vanno eliminate quelle dei figli nella stessa lingua.",
      destructive: true,
      input: { id: z.number().int(), lang: z.string() },
    },
    async ({ id, lang }) => {
      const node = await adminNode(id);
      if (!node.translations.some((x) => x.lang === lang)) throw new UserError("Traduzione non trovata.", 404);
      await deleteTranslation(id, lang);
      return { ok: true };
    },
  );

  addTool(
    server,
    "content_delete",
    {
      title: "Elimina un contenuto",
      description:
        "Elimina un nodo con tutte le traduzioni, i figli e gli elementi (a cascata, non recuperabile). Chiedi conferma all'utente prima di usarlo.",
      destructive: true,
      input: { id: z.number().int() },
    },
    async ({ id }) => {
      await adminNode(id);
      await deleteNode(id);
      return { ok: true };
    },
  );

  addTool(
    server,
    "content_seo_analysis",
    {
      title: "Analisi SEO",
      description:
        "Punteggio SEO (0–100) in stile Yoast di una traduzione, con i controlli superati e quelli da migliorare: parola chiave, lunghezze di titolo e description, testo, sottotitoli, immagini, link.",
      readOnly: true,
      input: { id: z.number().int(), lang: z.string() },
    },
    async ({ id, lang }) => {
      const node = await adminNode(id);
      const x = node.translations.find((item) => item.lang === lang);
      if (!x) throw new UserError("Traduzione non trovata.", 404);
      const ids: number[] = [];
      walkDoc(x.content, (n) => {
        if (n.type === "image" && n.attrs?.mediaId) ids.push(Number(n.attrs.mediaId));
      });
      const media = await getMediaMany(ids);
      const result = analyzeSeo({
        title: x.title,
        seoTitle: x.seoTitle ?? "",
        seoDescription: x.seoDescription ?? "",
        focusKeyword: x.focusKeyword ?? "",
        slug: x.slug,
        content: x.content,
        mediaAlt: Object.fromEntries(media.map((m) => [m.id, m.alt[lang]])),
      });
      return {
        ...result,
        checks: result.checks.map((c) => ({ ...c, message: t(`seo.checks.${c.id}.${c.result}`, c.params) })),
      };
    },
  );
}
