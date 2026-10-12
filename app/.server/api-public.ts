import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { localizedUrl } from "~/lib/languages";
import { ApiError } from "./api";
import { db, schema } from "./db";
import { loadMediaMap } from "./front";
import { visibleTranslation } from "./nodes";

const { nodes, nodeTranslations: tr } = schema;

/** Traduzione pubblicata serializzata per le API di lettura. */
export async function publicNode(id: number, lang: string, defaultLang: string) {
  const [row] = await db
    .select({ tr, node: nodes })
    .from(tr)
    .innerJoin(nodes, eq(nodes.id, tr.nodeId))
    .where(and(eq(tr.nodeId, id), eq(tr.lang, lang), visibleTranslation()));
  if (!row) throw new ApiError(404, "Contenuto non trovato in questa lingua.");
  const translations = await db
    .select({ lang: tr.lang, path: tr.path })
    .from(tr)
    .where(and(eq(tr.nodeId, id), visibleTranslation()));
  const ids: number[] = [];
  if (row.tr.ogImageId) ids.push(row.tr.ogImageId);
  JSON.stringify(row.tr.content ?? {}, (key, value) => {
    if (key === "mediaId" && value) ids.push(Number(value));
    return value;
  });
  return {
    id: row.node.id,
    type: row.node.type,
    parentId: row.node.parentId,
    template: row.node.template,
    lang,
    title: row.tr.title,
    slug: row.tr.slug,
    path: row.tr.path,
    url: localizedUrl(row.tr.path, lang, defaultLang),
    excerpt: row.tr.excerpt,
    content: row.tr.content,
    publishedAt: row.tr.publishedAt,
    updatedAt: row.tr.updatedAt,
    seo: {
      title: row.tr.seoTitle,
      description: row.tr.seoDescription,
      ogImageId: row.tr.ogImageId,
      noindex: row.tr.noindex,
    },
    media: await loadMediaMap(ids),
    translations: translations.map((t) => ({ lang: t.lang, url: localizedUrl(t.path, t.lang, defaultLang) })),
  };
}

export async function publicNodeList(options: { lang: string; defaultLang: string; type?: string | null; parentId?: number | null; page: number; perPage: number }) {
  const conditions = [eq(tr.lang, options.lang), visibleTranslation()];
  if (options.type) {
    if (!["page", "collection", "item"].includes(options.type)) throw new ApiError(400, "Tipo non valido.");
    conditions.push(eq(nodes.type, options.type as "page"));
  }
  if (options.parentId !== undefined) conditions.push(options.parentId === null ? isNull(nodes.parentId) : eq(nodes.parentId, options.parentId));
  const where = and(...conditions);
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(tr).innerJoin(nodes, eq(nodes.id, tr.nodeId)).where(where);
  const rows = await db
    .select({
      id: nodes.id,
      type: nodes.type,
      parentId: nodes.parentId,
      title: tr.title,
      path: tr.path,
      excerpt: tr.excerpt,
      publishedAt: tr.publishedAt,
    })
    .from(tr)
    .innerJoin(nodes, eq(nodes.id, tr.nodeId))
    .where(where)
    .orderBy(options.type === "item" ? desc(tr.publishedAt) : asc(nodes.sortOrder), asc(nodes.id))
    .limit(options.perPage)
    .offset((options.page - 1) * options.perPage);
  return {
    page: options.page,
    perPage: options.perPage,
    total: Number(total),
    items: rows.map((r) => ({ ...r, url: localizedUrl(r.path, options.lang, options.defaultLang) })),
  };
}

export function pagination(url: URL, maxPerPage = 100) {
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const perPage = Math.min(maxPerPage, Math.max(1, Number(url.searchParams.get("perPage")) || 20));
  return { page, perPage };
}

