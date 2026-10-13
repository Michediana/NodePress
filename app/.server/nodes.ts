import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { ContentDoc } from "~/lib/content";
import { localizedUrl, normalizeLangCode } from "~/lib/languages";
import { can } from "~/lib/roles";
import { joinPath, SLUG_PATTERN } from "~/lib/slug";
import type { ContentStatus } from "~/lib/status";
import { kindOfNode, type TemplateKind, type TemplateMeta } from "~/lib/theme/manifest";
import { getTemplateOptions } from "./theme";
import type { SessionUser } from "./auth";
import { db, schema, type Tx } from "./db";
import type { Node, NodeTranslation } from "./db/schema";
import { UserError } from "./forms";
import { getSiteLanguages } from "./languages";

const { nodes, nodeTranslations: tr } = schema;

export type NodeType = Node["type"];

/** Slug riservati a livello radice (rotte di sistema). */
const RESERVED_ROOT_SLUGS = ["admin", "api", "mcp", "uploads", "sitemap-xml", "robots-txt", "llms-txt"];

/** Condizione SQL per traduzioni visibili sul front. */
export function visibleTranslation(now = new Date()) {
  return and(
    inArray(tr.status, ["published", "scheduled"]),
    or(isNull(tr.publishedAt), lte(tr.publishedAt, now)),
  )!;
}

// --- Permessi ---

export function canEditNode(user: SessionUser, node: Pick<Node, "authorId">) {
  return can(user.role, "content.any") || (can(user.role, "content.own") && node.authorId === user.id);
}

export async function getNodeForUser(user: SessionUser, id: number) {
  const node = await db.query.nodes.findFirst({
    where: eq(nodes.id, id),
    with: { translations: true },
  });
  if (!node) throw new Response("Contenuto non trovato", { status: 404 });
  if (!canEditNode(user, node)) throw new Response("Non puoi modificare questo contenuto.", { status: 403 });
  return node;
}

// --- Lettura ---

export type TreeNode = Node & {
  translations: Pick<NodeTranslation, "lang" | "title" | "path" | "status" | "publishedAt">[];
  itemCount: number;
  children: TreeNode[];
};

/** Albero di pagine e raccoglitori (gli elementi dei raccoglitori sono esclusi). */
export async function getTree(): Promise<TreeNode[]> {
  const rows = await db.query.nodes.findMany({
    where: inArray(nodes.type, ["page", "collection"]),
    orderBy: [asc(nodes.sortOrder), asc(nodes.id)],
    with: {
      translations: {
        columns: { lang: true, title: true, path: true, status: true, publishedAt: true },
      },
    },
  });
  const counts = await db
    .select({ parentId: nodes.parentId, n: sql<number>`count(*)` })
    .from(nodes)
    .where(eq(nodes.type, "item"))
    .groupBy(nodes.parentId);
  const byId = new Map<number, TreeNode>();
  for (const row of rows) {
    byId.set(row.id, {
      ...row,
      itemCount: Number(counts.find((c) => c.parentId === row.id)?.n ?? 0),
      children: [],
    });
  }
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Elenco piatto di pagine e raccoglitori con indentazione, per le select. */
export async function getTreeOptions(lang: string) {
  const tree = await getTree();
  const options: { id: number; label: string; path?: string; depth: number; type: NodeType; langs: string[] }[] = [];
  const visit = (list: TreeNode[], depth: number) => {
    for (const node of list) {
      const t = node.translations.find((x) => x.lang === lang) ?? node.translations[0];
      options.push({
        id: node.id,
        label: t ? `${t.title} (${t.path})` : `#${node.id}`,
        path: t?.path,
        depth,
        type: node.type,
        langs: node.translations.map((x) => x.lang),
      });
      visit(node.children, depth + 1);
    }
  };
  visit(tree, 0);
  return options;
}

export async function getItems(collectionId: number, options: { page: number; perPage: number; lang?: string }) {
  const where = and(eq(nodes.parentId, collectionId), eq(nodes.type, "item"));
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(nodes).where(where);
  const rows = await db.query.nodes.findMany({
    where,
    orderBy: [desc(nodes.createdAt), desc(nodes.id)],
    limit: options.perPage,
    offset: (options.page - 1) * options.perPage,
    with: {
      translations: {
        columns: { lang: true, title: true, path: true, status: true, publishedAt: true, updatedAt: true },
      },
      author: { columns: { id: true, name: true } },
    },
  });
  return { total: Number(total), items: rows };
}

// --- Validazione ---

/**
 * Il template deve esistere nel tema attivo. Un valore invariato resta valido anche se il tema
 * non lo ha (es. dopo un cambio di tema): il front userà il template di default del tipo.
 */
function assertTemplate(templates: TemplateMeta[], type: NodeType, template: string, kind: TemplateKind, previous?: string | null) {
  if (previous !== undefined && template === previous) return;
  const def = templates.find((t) => t.name === template);
  if (!def || !def.kinds.includes(kind)) {
    throw new UserError(`Template "${template}" non valido per ${type}.`);
  }
}

async function assertParent(tx: Tx, type: NodeType, parentId: number | null, selfId?: number) {
  if (type === "item") {
    if (!parentId) throw new UserError("Un elemento deve appartenere a un raccoglitore.");
    const [parent] = await tx.select().from(nodes).where(eq(nodes.id, parentId));
    if (parent?.type !== "collection") throw new UserError("Il genitore di un elemento deve essere un raccoglitore.");
    return;
  }
  if (!parentId) return;
  let currentId: number | null = parentId;
  let first = true;
  while (currentId) {
    if (currentId === selfId) throw new UserError("Un nodo non può essere spostato dentro se stesso.");
    const [row]: Node[] = await tx.select().from(nodes).where(eq(nodes.id, currentId));
    if (!row) throw new UserError("Genitore non trovato.");
    if (first && row.type !== "page") {
      throw new UserError("Pagine e raccoglitori possono stare solo sotto una pagina.");
    }
    first = false;
    currentId = row.parentId;
  }
}

// --- Scrittura nodi ---

export type NodeInput = {
  parentId: number | null;
  type: NodeType;
  template: string;
  itemTemplate?: string | null;
  perPage?: number;
};

export async function createNode(authorId: number | null, input: NodeInput) {
  const { templates, defaults } = await getTemplateOptions();
  return db.transaction(async (tx) => {
    await assertParent(tx, input.type, input.parentId);
    if (input.type === "item") {
      // Gli elementi ereditano il template dal raccoglitore.
      const [parent] = await tx.select().from(nodes).where(eq(nodes.id, input.parentId!));
      input.template = parent.itemTemplate ?? defaults.item;
      assertTemplate(templates, input.type, input.template, "item", parent.itemTemplate);
    } else {
      assertTemplate(templates, input.type, input.template, kindOfNode(input.type));
    }
    if (input.type === "collection") assertTemplate(templates, input.type, input.itemTemplate ?? "", "item");
    const [{ max }] = await tx
      .select({ max: sql<number | null>`max(${nodes.sortOrder})` })
      .from(nodes)
      .where(input.parentId ? eq(nodes.parentId, input.parentId) : isNull(nodes.parentId));
    const [result] = await tx.insert(nodes).values({
      parentId: input.parentId,
      type: input.type,
      template: input.template,
      itemTemplate: input.type === "collection" ? input.itemTemplate : null,
      perPage: input.perPage ?? 10,
      sortOrder: (max ?? -1) + 1,
      authorId,
    });
    return result.insertId;
  });
}

export async function updateNode(id: number, input: Omit<NodeInput, "type">) {
  const [{ defaultLang }, { templates }] = await Promise.all([getSiteLanguages(), getTemplateOptions()]);
  return db.transaction(async (tx) => {
    const [node] = await tx.select().from(nodes).where(eq(nodes.id, id));
    if (!node) throw new UserError("Nodo non trovato.", 404);
    const template = node.type === "item" ? node.template : input.template;
    assertTemplate(templates, node.type, template, kindOfNode(node.type), node.template);
    if (node.type === "collection") assertTemplate(templates, node.type, input.itemTemplate ?? "", "item", node.itemTemplate);
    const parentChanged = (input.parentId ?? null) !== (node.parentId ?? null);
    if (parentChanged) await assertParent(tx, node.type, input.parentId, id);

    await tx
      .update(nodes)
      .set({
        parentId: input.parentId,
        template,
        itemTemplate: node.type === "collection" ? input.itemTemplate : null,
        perPage: input.perPage ?? node.perPage,
      })
      .where(eq(nodes.id, id));

    if (node.type === "collection" && input.itemTemplate && input.itemTemplate !== node.itemTemplate) {
      await tx
        .update(nodes)
        .set({ template: input.itemTemplate })
        .where(and(eq(nodes.parentId, id), eq(nodes.type, "item")));
    }

    if (parentChanged) {
      const translations = await tx.select().from(tr).where(eq(tr.nodeId, id));
      for (const t of translations) {
        const parentPath = await getParentPath(tx, input.parentId, t.lang);
        if (parentPath === undefined) {
          throw new UserError(`Il nuovo genitore non ha una traduzione in "${t.lang}".`);
        }
        await movePath(tx, id, t.lang, t.path, joinPath(parentPath, t.slug), defaultLang);
      }
    }
  });
}

export async function moveNode(id: number, direction: "up" | "down") {
  await db.transaction(async (tx) => {
    const [node] = await tx.select().from(nodes).where(eq(nodes.id, id));
    if (!node) return;
    const types: NodeType[] = node.type === "item" ? ["item"] : ["page", "collection"];
    const all = await tx
      .select()
      .from(nodes)
      .where(and(node.parentId ? eq(nodes.parentId, node.parentId) : isNull(nodes.parentId), inArray(nodes.type, types)))
      .orderBy(asc(nodes.sortOrder), asc(nodes.id));
    const index = all.findIndex((n) => n.id === id);
    const swap = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swap < 0 || swap >= all.length) return;
    [all[index], all[swap]] = [all[swap], all[index]];
    for (const [i, n] of all.entries()) {
      if (n.sortOrder !== i) await tx.update(nodes).set({ sortOrder: i }).where(eq(nodes.id, n.id));
    }
  });
}

export async function deleteNode(id: number) {
  // Le traduzioni, i figli e gli elementi vengono eliminati a cascata.
  await db.delete(nodes).where(eq(nodes.id, id));
}

// --- Traduzioni ---

export type TranslationInput = {
  title: string;
  slug: string;
  excerpt?: string | null;
  content?: ContentDoc | null;
  status: ContentStatus;
  publishedAt?: Date | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  focusKeyword?: string | null;
  ogImageId?: number | null;
  noindex?: boolean;
};

/** Percorso del genitore in una lingua: null = radice, undefined = traduzione mancante. */
async function getParentPath(tx: Tx, parentId: number | null, lang: string) {
  if (!parentId) return null;
  const [row] = await tx
    .select({ path: tr.path })
    .from(tr)
    .where(and(eq(tr.nodeId, parentId), eq(tr.lang, lang)));
  return row?.path;
}

/** Aggiorna il percorso di un nodo e di tutti i discendenti, creando i redirect 301. */
async function movePath(tx: Tx, nodeId: number, lang: string, oldPath: string, newPath: string, defaultLang: string) {
  if (oldPath === newPath) return;
  const descendants = await tx
    .select({ id: tr.id, path: tr.path })
    .from(tr)
    .where(and(eq(tr.lang, lang), sql`${tr.path} like ${oldPath === "/" ? "/%" : `${escapeLike(oldPath)}/%`}`));
  const conflict = await tx
    .select({ id: tr.id })
    .from(tr)
    .where(and(eq(tr.lang, lang), eq(tr.path, newPath), sql`${tr.nodeId} <> ${nodeId}`));
  if (conflict.length) throw new UserError(`Esiste già un contenuto con percorso ${newPath}.`);

  await tx.update(tr).set({ path: newPath }).where(and(eq(tr.nodeId, nodeId), eq(tr.lang, lang)));
  await addAutoRedirect(tx, localizedUrl(oldPath, lang, defaultLang), localizedUrl(newPath, lang, defaultLang));

  if (oldPath === "/") return; // la home non ha discendenti per prefisso
  for (const d of descendants) {
    const updated = newPath + d.path.slice(oldPath.length);
    await tx.update(tr).set({ path: updated }).where(eq(tr.id, d.id));
    await addAutoRedirect(tx, localizedUrl(d.path, lang, defaultLang), localizedUrl(updated, lang, defaultLang));
  }
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function addAutoRedirect(tx: Tx, from: string, to: string) {
  if (from === to) return;
  const { redirects } = schema;
  // La nuova destinazione non può essere a sua volta un redirect.
  await tx.delete(redirects).where(eq(redirects.fromPath, to));
  // Evita catene: i redirect che puntavano al vecchio URL puntano al nuovo.
  await tx.update(redirects).set({ toPath: to }).where(eq(redirects.toPath, from));
  await tx
    .insert(redirects)
    .values({ fromPath: from, toPath: to, statusCode: 301, automatic: true })
    .onDuplicateKeyUpdate({ set: { toPath: to, statusCode: 301, automatic: true } });
}

function normalizeStatus(status: ContentStatus, publishedAt: Date | null | undefined) {
  // Al secondo: MySQL arrotonda i millisecondi e "adesso" finirebbe nel futuro, quindi programmato.
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  if (status === "draft") return { status, publishedAt: publishedAt ?? null };
  if (status === "scheduled") {
    if (!publishedAt) throw new UserError("Indica la data di pubblicazione programmata.");
    return { status: publishedAt > now ? ("scheduled" as const) : ("published" as const), publishedAt };
  }
  const date = publishedAt ?? now;
  return { status: date > now ? ("scheduled" as const) : ("published" as const), publishedAt: date };
}

export async function saveTranslation(nodeId: number, langInput: string, input: TranslationInput) {
  const site = await getSiteLanguages();
  const lang = normalizeLangCode(langInput);
  if (!lang || !site.codes.includes(lang)) throw new UserError("Lingua non attiva.");

  return db.transaction(async (tx) => {
    const [node] = await tx.select().from(nodes).where(eq(nodes.id, nodeId));
    if (!node) throw new UserError("Nodo non trovato.", 404);

    const slug = input.slug.trim();
    const isHome = slug === "" && node.parentId === null && node.type === "page";
    if (!isHome && !SLUG_PATTERN.test(slug)) {
      throw new UserError("Lo slug può contenere solo lettere minuscole, numeri e trattini.", 400, { slug: "Slug non valido." });
    }
    if (!node.parentId && (RESERVED_ROOT_SLUGS.includes(slug) || normalizeLangCode(slug))) {
      throw new UserError(`Lo slug "${slug}" è riservato a livello radice.`, 400, { slug: "Slug riservato." });
    }

    const parentPath = await getParentPath(tx, node.parentId, lang);
    if (parentPath === undefined) {
      throw new UserError("Traduci prima il contenuto genitore in questa lingua.");
    }
    const path = joinPath(parentPath, slug);
    const { status, publishedAt } = normalizeStatus(input.status, input.publishedAt);

    const values = {
      title: input.title.trim(),
      slug,
      excerpt: input.excerpt || null,
      content: input.content ?? null,
      status,
      publishedAt,
      seoTitle: input.seoTitle || null,
      seoDescription: input.seoDescription || null,
      focusKeyword: input.focusKeyword || null,
      ogImageId: input.ogImageId || null,
      noindex: input.noindex ?? false,
    };

    const [existing] = await tx.select().from(tr).where(and(eq(tr.nodeId, nodeId), eq(tr.lang, lang)));
    if (existing) {
      await movePath(tx, nodeId, lang, existing.path, path, site.defaultLang);
      await tx.update(tr).set(values).where(eq(tr.id, existing.id));
    } else {
      const conflict = await tx.select({ id: tr.id }).from(tr).where(and(eq(tr.lang, lang), eq(tr.path, path)));
      if (conflict.length) {
        throw new UserError(`Esiste già un contenuto con percorso ${path}.`, 400, { slug: "Slug già in uso." });
      }
      await tx.insert(tr).values({ ...values, nodeId, lang, path });
      // Un redirect sullo stesso URL renderebbe irraggiungibile il nuovo contenuto.
      await tx.delete(schema.redirects).where(eq(schema.redirects.fromPath, localizedUrl(path, lang, site.defaultLang)));
    }
    await tx.update(nodes).set({ updatedAt: new Date() }).where(eq(nodes.id, nodeId));
    return { path };
  });
}

export async function deleteTranslation(nodeId: number, lang: string) {
  await db.transaction(async (tx) => {
    const children = await tx
      .select({ id: tr.id })
      .from(tr)
      .innerJoin(nodes, eq(nodes.id, tr.nodeId))
      .where(and(eq(nodes.parentId, nodeId), eq(tr.lang, lang)));
    if (children.length) {
      throw new UserError("Elimina prima le traduzioni dei contenuti figli in questa lingua.");
    }
    await tx.delete(tr).where(and(eq(tr.nodeId, nodeId), eq(tr.lang, lang)));
  });
}

