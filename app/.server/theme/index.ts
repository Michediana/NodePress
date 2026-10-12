import { createCookie, redirect } from "react-router";
import { componentPath, type CompiledFile, type ThemeBundle } from "~/lib/theme/ast";
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

/** Il file d'ingresso e tutti i componenti del tema che usa, anche indirettamente. */
export function bundleFor(data: ThemeBuildData, entry: string): ThemeBundle {
  const files: Record<string, CompiledFile> = {};
  const visit = (file: string) => {
    const compiled = data.files[file];
    if (!compiled || files[file]) return;
    files[file] = compiled;
    for (const name of compiled.uses) visit(componentPath(name));
  };
  visit(entry);
  return { entry, files };
}

/** Bundle del template del nodo; se il tema non lo ha, quello di default per il tipo. */
export function templateBundle(data: ThemeBuildData, template: string, kind: TemplateKind) {
  const file = `templates/${template}.np`;
  if (data.files[file]) return bundleFor(data, file);
  return bundleFor(data, `templates/${defaultTemplates(data.manifest)[kind]}.np`);
}

/** Template assegnabili ai nodi, dal tema attivo. */
export async function getTemplateOptions() {
  const active = await ensureActiveTheme();
  const { manifest } = await loadBuild(active.publishedBuildId!);
  return { templates: templateList(manifest), defaults: defaultTemplates(manifest) };
}
