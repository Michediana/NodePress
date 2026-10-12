import { asc, eq } from "drizzle-orm";
import { languageName, localizedUrl } from "~/lib/languages";
import { db, schema } from "./db";
import { getSiteLanguages } from "./languages";
import { visibleTranslation } from "./nodes";
import { getSettings } from "./settings";

const { nodeTranslations: tr, nodes } = schema;

/** Traduzioni pubblicate e indicizzabili, raggruppate per nodo. */
async function indexableByNode() {
  const rows = await db
    .select({
      nodeId: tr.nodeId,
      lang: tr.lang,
      path: tr.path,
      title: tr.title,
      description: tr.seoDescription,
      excerpt: tr.excerpt,
      noindex: tr.noindex,
      updatedAt: tr.updatedAt,
      type: nodes.type,
    })
    .from(tr)
    .innerJoin(nodes, eq(nodes.id, tr.nodeId))
    .where(visibleTranslation())
    .orderBy(asc(nodes.parentId), asc(nodes.sortOrder), asc(tr.path));
  const groups = new Map<number, typeof rows>();
  for (const row of rows) {
    if (!groups.has(row.nodeId)) groups.set(row.nodeId, []);
    groups.get(row.nodeId)!.push(row);
  }
  return groups;
}

function xmlEscape(value: string) {
  return value.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

export async function buildSitemap(siteUrl: string) {
  const { defaultLang } = await getSiteLanguages();
  const groups = await indexableByNode();
  const urls: string[] = [];
  for (const group of groups.values()) {
    const indexable = group.filter((r) => !r.noindex);
    const alternates = indexable.map((r) => ({
      lang: r.lang,
      href: siteUrl + localizedUrl(r.path, r.lang, defaultLang),
    }));
    const xDefault = alternates.find((a) => a.lang === defaultLang);
    for (const row of indexable) {
      const links = alternates.length > 1
        ? [
            ...alternates.map((a) => `    <xhtml:link rel="alternate" hreflang="${a.lang}" href="${xmlEscape(a.href)}"/>`),
            ...(xDefault ? [`    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(xDefault.href)}"/>`] : []),
          ]
        : [];
      urls.push(
        [
          "  <url>",
          `    <loc>${xmlEscape(siteUrl + localizedUrl(row.path, row.lang, defaultLang))}</loc>`,
          `    <lastmod>${row.updatedAt.toISOString()}</lastmod>`,
          ...links,
          "  </url>",
        ].join("\n"),
      );
    }
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

export function defaultRobots(siteUrl: string) {
  return ["User-agent: *", "Disallow: /admin/", "Disallow: /api/", "", `Sitemap: ${siteUrl}/sitemap.xml`, ""].join("\n");
}

export async function defaultLlms(siteUrl: string) {
  const { siteName } = await getSettings(["siteName"]);
  const { codes, defaultLang } = await getSiteLanguages();
  const groups = await indexableByNode();
  const lines = [`# ${siteName}`, ""];
  const home = [...groups.values()].flat().find((r) => r.path === "/" && r.lang === defaultLang);
  if (home?.description) lines.push(`> ${home.description}`, "");
  for (const lang of codes) {
    const entries = [...groups.values()].flat().filter((r) => r.lang === lang && !r.noindex);
    if (!entries.length) continue;
    lines.push(`## ${languageName(lang, lang)}`, "");
    for (const r of entries) {
      const desc = r.description || r.excerpt;
      const url = siteUrl + localizedUrl(r.path, lang, defaultLang);
      lines.push(`- [${r.title}](${url})${desc ? `: ${desc.replace(/\s+/g, " ").trim()}` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export async function getRobotsTxt(siteUrl: string) {
  const { robotsTxt } = await getSettings(["robotsTxt"]);
  return robotsTxt ?? defaultRobots(siteUrl);
}

export async function getLlmsTxt(siteUrl: string) {
  const { llmsTxt } = await getSettings(["llmsTxt"]);
  return llmsTxt ?? (await defaultLlms(siteUrl));
}

