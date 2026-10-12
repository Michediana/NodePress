import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "./db";
import { getSiteLanguages } from "./languages";
import { visibleTranslation } from "./nodes";
import { getSetting } from "./settings";

const { nodes, nodeTranslations: tr, menus, media } = schema;

/** Dati reali del sito usati per compilare gli esempi della documentazione API. */
export async function getApiDocsContext(request: Request) {
  const { codes, defaultLang } = await getSiteLanguages();
  const published = (type?: "page" | "collection" | "item") =>
    db
      .select({ id: nodes.id, path: tr.path, title: tr.title })
      .from(tr)
      .innerJoin(nodes, eq(nodes.id, tr.nodeId))
      .where(and(eq(tr.lang, defaultLang), visibleTranslation(), type ? eq(nodes.type, type) : undefined))
      .orderBy(asc(nodes.parentId), asc(nodes.sortOrder), asc(nodes.id))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  const [page, collection, [menu], [file]] = await Promise.all([
    published("page").then((row) => row ?? published()),
    published("collection"),
    db.select({ location: menus.location }).from(menus).where(isNotNull(menus.location)).orderBy(asc(menus.name)).limit(1),
    db.select({ id: media.id }).from(media).orderBy(desc(media.id)).limit(1),
  ]);
  return {
    baseUrl: `${new URL(request.url).origin}/api/v1`,
    publicApi: await getSetting("publicApi"),
    languages: codes,
    defaultLang,
    otherLang: codes.find((c) => c !== defaultLang) ?? null,
    page,
    collection,
    menuLocation: menu?.location ?? null,
    mediaId: file?.id ?? null,
  };
}

export type ApiDocsContext = Awaited<ReturnType<typeof getApiDocsContext>>;
