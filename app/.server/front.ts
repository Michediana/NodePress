import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { redirect } from "react-router";
import { walkDoc, type ContentDoc } from "~/lib/content";
import { localizedUrl } from "~/lib/languages";
import type { MediaRef } from "~/lib/media";
import { db, schema } from "./db";
import { getSiteLanguages } from "./languages";
import { visibleTranslation } from "./nodes";
import { findRedirect } from "./redirects";

const { nodes, nodeTranslations: tr, media } = schema;

/**
 * URL pubblico della richiesta. Nelle navigazioni client React Router chiede i dati a
 * `/percorso.data` (e `/_.data` o `/_root.data` per la home), con il parametro `_routes`:
 * li togliamo per risolvere il contenuto come in una richiesta normale.
 */
export function publicUrl(request: Request) {
  const url = new URL(request.url);
  if (url.pathname === "/_.data" || url.pathname === "/_root.data") url.pathname = "/";
  else if (url.pathname.endsWith(".data")) url.pathname = url.pathname.slice(0, -".data".length);
  url.searchParams.delete("_routes");
  return url;
}

/** Ricava lingua e percorso (senza prefisso) da un pathname. */
export async function resolveLang(pathname: string) {
  const site = await getSiteLanguages();
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (first && site.codes.includes(first)) {
    const rest = `/${segments.slice(1).join("/")}`;
    return { ...site, lang: first, path: rest, prefixed: true };
  }
  return { ...site, lang: site.defaultLang, path: `/${segments.join("/")}`, prefixed: false };
}

export type ListingItem = {
  id: number;
  title: string;
  excerpt: string | null;
  url: string;
  publishedAt: string | null;
  image: MediaRef | null;
};

export type PageData = {
  lang: string;
  defaultLang: string;
  url: string;
  node: { id: number; type: "page" | "collection" | "item"; template: string };
  translation: {
    title: string;
    excerpt: string | null;
    content: ContentDoc | null;
    path: string;
    publishedAt: string | null;
    updatedAt: string;
    seoTitle: string | null;
    seoDescription: string | null;
    noindex: boolean;
    ogImageId: number | null;
  };
  media: Record<number, MediaRef>;
  alternates: { lang: string; href: string }[];
  breadcrumbs: { title: string; href: string }[];
  listing: { items: ListingItem[]; page: number; pages: number; total: number } | null;
};

function mediaIdsOf(doc: ContentDoc | null | undefined) {
  const ids: number[] = [];
  walkDoc(doc, (n) => {
    if (n.type === "image" && n.attrs?.mediaId) ids.push(Number(n.attrs.mediaId));
    if (n.type === "gallery") {
      for (const img of (n.attrs?.images as { mediaId: number }[]) ?? []) ids.push(Number(img.mediaId));
    }
  });
  return ids;
}

export async function loadMediaMap(ids: number[]): Promise<Record<number, MediaRef>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const rows = await db
    .select({ id: media.id, file: media.file, mime: media.mime, width: media.width, height: media.height, variants: media.variants, alt: media.alt })
    .from(media)
    .where(inArray(media.id, unique));
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

/** Percorsi degli antenati: "/a/b/c" → ["/a", "/a/b"]. */
function ancestorPaths(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, i) => `/${parts.slice(0, i + 1).join("/")}`);
}

/**
 * Risolve la richiesta del front: contenuto, redirect o 404.
 * Lancia `redirect` o una Response 404 quando necessario.
 */
export async function loadPage(request: Request): Promise<PageData> {
  const url = publicUrl(request);
  const pathname = decodeURIComponent(url.pathname);

  // Normalizza lo slash finale.
  if (pathname.length > 1 && pathname.endsWith("/")) {
    throw redirect(pathname.replace(/\/+$/, "") + url.search, 301);
  }

  const site = await resolveLang(pathname);
  const { lang, defaultLang, path } = site;
  // La lingua di default non usa il prefisso.
  if (site.prefixed && lang === defaultLang) throw redirect((path === "/" ? "/" : path) + url.search, 301);

  const now = new Date();
  const [row] = await db
    .select({ tr, node: nodes })
    .from(tr)
    .innerJoin(nodes, eq(nodes.id, tr.nodeId))
    .where(and(eq(tr.lang, lang), eq(tr.path, path), visibleTranslation(now)));

  if (!row) {
    const target = await findRedirect(pathname);
    if (target) throw redirect(target.toPath + url.search, target.statusCode);
    throw new Response("Not found", { status: 404 });
  }

  // Tutti gli antenati devono essere pubblicati in questa lingua.
  const ancestors = ancestorPaths(path);
  const ancestorRows = ancestors.length
    ? await db
        .select({ path: tr.path, title: tr.title })
        .from(tr)
        .where(and(eq(tr.lang, lang), inArray(tr.path, ancestors), visibleTranslation(now)))
    : [];
  if (ancestorRows.length !== ancestors.length) throw new Response("Not found", { status: 404 });

  const { tr: translation, node } = row;

  // Traduzioni pubblicate dello stesso nodo, per hreflang e selettore lingua.
  const siblings = await db
    .select({ lang: tr.lang, path: tr.path, noindex: tr.noindex })
    .from(tr)
    .where(and(eq(tr.nodeId, node.id), visibleTranslation(now)));
  const alternates = siblings
    .filter((s) => site.codes.includes(s.lang))
    .sort((a, b) => site.codes.indexOf(a.lang) - site.codes.indexOf(b.lang))
    .map((s) => ({ lang: s.lang, href: localizedUrl(s.path, s.lang, defaultLang) }));

  const breadcrumbs = [
    ...ancestors.map((p) => ({
      title: ancestorRows.find((a) => a.path === p)!.title,
      href: localizedUrl(p, lang, defaultLang),
    })),
    { title: translation.title, href: localizedUrl(path, lang, defaultLang) },
  ];

  const mediaIds = mediaIdsOf(translation.content);
  if (translation.ogImageId) mediaIds.push(translation.ogImageId);

  let listing: PageData["listing"] = null;
  if (node.type === "collection") {
    const perPage = node.perPage;
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const where = and(eq(nodes.parentId, node.id), eq(nodes.type, "item"), eq(tr.lang, lang), visibleTranslation(now));
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(tr)
      .innerJoin(nodes, eq(nodes.id, tr.nodeId))
      .where(where);
    const pages = Math.max(1, Math.ceil(Number(total) / perPage));
    if (page > pages) throw new Response("Not found", { status: 404 });
    const items = await db
      .select({
        id: nodes.id,
        title: tr.title,
        excerpt: tr.excerpt,
        path: tr.path,
        publishedAt: tr.publishedAt,
        ogImageId: tr.ogImageId,
        content: tr.content,
      })
      .from(tr)
      .innerJoin(nodes, eq(nodes.id, tr.nodeId))
      .where(where)
      .orderBy(desc(tr.publishedAt), desc(nodes.id))
      .limit(perPage)
      .offset((page - 1) * perPage);
    const imageIds = items.map((i) => i.ogImageId ?? mediaIdsOf(i.content)[0] ?? 0);
    const itemMedia = await loadMediaMap(imageIds);
    listing = {
      page,
      pages,
      total: Number(total),
      items: items.map((item, index) => ({
        id: item.id,
        title: item.title,
        excerpt: item.excerpt,
        url: localizedUrl(item.path, lang, defaultLang),
        publishedAt: item.publishedAt?.toISOString() ?? null,
        image: itemMedia[imageIds[index]] ?? null,
      })),
    };
  }

  return {
    lang,
    defaultLang,
    url: localizedUrl(path, lang, defaultLang),
    node: { id: node.id, type: node.type, template: node.template },
    translation: {
      title: translation.title,
      excerpt: translation.excerpt,
      content: translation.content,
      path: translation.path,
      publishedAt: translation.publishedAt?.toISOString() ?? null,
      updatedAt: translation.updatedAt.toISOString(),
      seoTitle: translation.seoTitle,
      seoDescription: translation.seoDescription,
      noindex: translation.noindex,
      ogImageId: translation.ogImageId,
    },
    media: await loadMediaMap(mediaIds),
    alternates,
    breadcrumbs,
    listing,
  };
}
