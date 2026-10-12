import { createCookie, redirect } from "react-router";
import { walkDoc, type ContentDoc } from "~/lib/content";
import { componentPath, type ThemeBundle } from "~/lib/theme/ast";
import { sectionPath, walkSections, type ItemsQuery, type SectionNode } from "~/lib/theme/sections";
import { collectionItems, loadMediaMap, resolveCollectionId } from "../front";
import { defaultTemplates, templateList, type TemplateKind, type ThemeBuildData } from "~/lib/theme/manifest";
import { getSessionUser } from "../auth";
import { ensureActiveTheme, findTheme, getBuild } from "./store";

// Tema usato dal front: la build pubblicata del tema attivo oppure, per un admin in anteprima,
// la bozza di un tema qualsiasi. Le build sono immutabili, quindi si tengono in cache per id.

export type FrontTheme = { name: string; buildId: number; data: ThemeBuildData; preview: boolean };

// A scadenza: se l'editor si chiude senza disattivarla, l'anteprima non resta attiva a lungo.
// L'editor la rinnova a ogni ricarica.
const previewCookie = createCookie("np_preview", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 30 * 60 });

const MAX_CACHED_BUILDS = 32;
const buildCache = new Map<number, ThemeBuildData>();

async function loadBuild(id: number) {
  const cached = buildCache.get(id);
  if (cached) return cached;
  const build = await getBuild(id);
  if (!build) throw new Error(`Build del tema ${id} non trovata.`);
  // Le build create prima delle sezioni (fase 2.4) non hanno schemi, alberi e gruppi.
  build.data.schemas ??= {};
  build.data.trees ??= {};
  for (const file of Object.values(build.data.files)) file.groups ??= [];
  if (buildCache.size >= MAX_CACHED_BUILDS) buildCache.delete(buildCache.keys().next().value!);
  buildCache.set(id, build.data);
  return build.data;
}

/**
 * `?np_preview=<tema>` attiva l'anteprima della bozza (solo admin), `?np_preview=off` la chiude.
 * Restituisce il redirect da lanciare, oppure null.
 */
export async function previewRedirect(request: Request) {
  const url = new URL(request.url);
  const value = url.searchParams.get("np_preview");
  if (value === null) return null;
  url.searchParams.delete("np_preview");
  const target = url.pathname + url.search;
  const user = await getSessionUser(request);
  if (value === "off" || value === "" || user?.role !== "admin") {
    return redirect(target, { headers: { "Set-Cookie": await previewCookie.serialize("", { maxAge: 0 }) } });
  }
  return redirect(target, { headers: { "Set-Cookie": await previewCookie.serialize(value) } });
}

export async function getFrontTheme(request: Request): Promise<FrontTheme> {
  const preview = await previewCookie.parse(request.headers.get("Cookie"));
  if (typeof preview === "string" && preview) {
    const user = await getSessionUser(request);
    const theme = user?.role === "admin" ? await findTheme(preview) : null;
    if (theme?.draftBuildId) {
      return {
        name: theme.name,
        buildId: theme.draftBuildId,
        data: await loadBuild(theme.draftBuildId),
        preview: true,
      };
    }
  }
  const active = await ensureActiveTheme();
  const buildId = active.publishedBuildId!;
  return { name: active.name, buildId, data: await loadBuild(buildId), preview: false };
}

/**
 * Il file d'ingresso e tutto ciò che usa, anche indirettamente: componenti, gruppi, sezioni
 * (anche quelle inserite nel contenuto con il blocco "Sezione") e blocchi ridisegnati.
 */
export function bundleFor(data: ThemeBuildData, entry: string, contents: (ContentDoc | null)[] = []): ThemeBundle {
  const bundle: ThemeBundle = { entry, files: {}, trees: {}, schemas: {}, data: {}, media: {} };
  const visitFile = (file: string) => {
    const compiled = data.files[file];
    if (!compiled || bundle.files[file]) return;
    bundle.files[file] = compiled;
    for (const name of compiled.uses) visitFile(componentPath(name));
    for (const name of compiled.groups) visitTree(`groups/${name}.json`);
  };
  const visitSection = (type: string) => {
    const schema = data.schemas[type];
    if (!schema || bundle.schemas[type]) return;
    bundle.schemas[type] = schema;
    visitFile(sectionPath(type));
  };
  const visitTree = (key: string) => {
    const tree = data.trees[key];
    if (!tree || bundle.trees[key]) return;
    bundle.trees[key] = tree;
    if (tree.layout) visitFile(componentPath(tree.layout));
    walkSections(tree.sections, (node) => visitSection(node.type));
  };
  if (entry.endsWith(".json")) visitTree(entry);
  else visitFile(entry);
  for (const file of Object.keys(data.files)) if (file.startsWith("blocks/")) visitFile(file);
  for (const doc of contents)
    walkDoc(doc, (node) => node.type === "section" && visitSection(String(node.attrs?.section ?? "")));
  return bundle;
}

/** Bundle del template del nodo; se il tema non lo ha, quello di default per il tipo. */
export function templateBundle(
  data: ThemeBuildData,
  template: string,
  kind: TemplateKind,
  contents: (ContentDoc | null)[] = [],
) {
  const name = data.manifest.templates[template] ? template : defaultTemplates(data.manifest)[kind];
  const entry = data.trees[`templates/${name}.json`] ? `templates/${name}.json` : `templates/${name}.np`;
  return bundleFor(data, entry, contents);
}

/** Sezioni inserite nel contenuto con il blocco "Sezione". */
function contentSections(docs: (ContentDoc | null)[]): SectionNode[] {
  const nodes: SectionNode[] = [];
  for (const doc of docs) {
    walkDoc(doc, (node) => {
      if (node.type !== "section" || !node.attrs?.id) return;
      const settings = node.attrs.settings;
      nodes.push({
        id: String(node.attrs.id),
        type: String(node.attrs.section ?? ""),
        settings: settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {},
        slots: {},
      });
    });
  }
  return nodes;
}

/**
 * Calcola sul server i dati delle sezioni del bundle: elementi dei raccoglitori per le
 * impostazioni "items" e media per le impostazioni "media". Il resto (valori fissi e dati
 * legati alla pagina) si risolve nel renderer, uguale in SSR e nel browser.
 */
export async function resolveBundleData(
  bundle: ThemeBundle,
  ctx: { lang: string; defaultLang: string; contents?: (ContentDoc | null)[] },
) {
  const nodes: SectionNode[] = [];
  for (const tree of Object.values(bundle.trees)) walkSections(tree.sections, (node) => nodes.push(node));
  nodes.push(...contentSections(ctx.contents ?? []));

  const mediaIds = new Set<number>();
  const collections = new Map<string, Promise<number | null>>();
  const jobs: Promise<void>[] = [];
  for (const node of nodes) {
    const schema = bundle.schemas[node.type];
    if (!schema) continue;
    for (const [key, def] of Object.entries(schema.settings)) {
      const value = node.settings[key] ?? def.default;
      if (def.type === "media" && typeof value === "number") mediaIds.add(value);
      if (def.type === "items" && value && typeof value === "object" && "collection" in value) {
        const query = value as ItemsQuery;
        const ref = String(query.collection);
        if (!collections.has(ref)) collections.set(ref, resolveCollectionId(query.collection, ctx.defaultLang));
        jobs.push(
          collections.get(ref)!.then(async (id) => {
            const items = id
              ? await collectionItems(
                  id,
                  ctx.lang,
                  ctx.defaultLang,
                  Math.min(Math.max(query.limit ?? 6, 1), 100),
                  query.offset ?? 0,
                )
              : [];
            (bundle.data[node.id] ??= {})[key] = items;
          }),
        );
      }
    }
  }
  await Promise.all(jobs);
  bundle.media = await loadMediaMap([...mediaIds]);
  return bundle;
}

/** Build pubblicata del tema attivo. */
export async function getActiveBuild() {
  const active = await ensureActiveTheme();
  return loadBuild(active.publishedBuildId!);
}

/** Template assegnabili ai nodi, dal tema attivo. */
export async function getTemplateOptions() {
  const active = await ensureActiveTheme();
  const { manifest } = await loadBuild(active.publishedBuildId!);
  return { templates: templateList(manifest), defaults: defaultTemplates(manifest) };
}
