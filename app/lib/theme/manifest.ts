import type { CompiledFile } from "./ast";

// Manifest del tema (`theme.json`) e dati di una build: condivisi tra server e pannello.

export type TemplateKind = "page" | "listing" | "item";

export type TemplateMeta = { name: string; label: string; kinds: TemplateKind[] };

export type ThemeToken = {
  type: "color" | "font" | "size" | "number" | "text";
  label?: string;
  group?: string;
  default: string;
};

export type ThemeManifest = {
  name: string;
  label: string;
  version?: string;
  description?: string;
  author?: string;
  /** Template assegnabili ai nodi. */
  templates: Record<string, { label: string; kinds: TemplateKind[] }>;
  /** Template di default per tipo; se manca, il primo dichiarato per quel tipo. */
  defaults?: Partial<Record<TemplateKind, string>>;
  /** Token di design, scritti come custom properties `--np-<nome>`. */
  tokens?: Record<string, ThemeToken>;
};

export type ThemeBuildData = {
  manifest: ThemeManifest;
  /** Markup compilato, per percorso (`templates/home.np`, `components/Card.np`…). */
  files: Record<string, CompiledFile>;
  /** URL del CSS e del JS compilati (null se il tema non ne ha). */
  css: string | null;
  js: string | null;
  /** Asset statici del tema: percorso → URL pubblico con hash. */
  assets: Record<string, string>;
  /** Hash di tutti gli asset referenziati (CSS e JS compresi), per la pulizia. */
  assetHashes: string[];
  /** Hash dei sorgenti: se non cambia, la build non si rifà. */
  sourceHash: string;
};

export const TEMPLATE_KINDS: TemplateKind[] = ["page", "listing", "item"];

export function templateList(manifest: ThemeManifest): TemplateMeta[] {
  return Object.entries(manifest.templates).map(([name, def]) => ({ name, ...def }));
}

export const templatesOfKind = (list: TemplateMeta[], kind: TemplateKind) => list.filter((t) => t.kinds.includes(kind));

/** Template di default per tipo: quello indicato in `defaults`, altrimenti il primo dichiarato. */
export function defaultTemplates(manifest: ThemeManifest): Record<TemplateKind, string> {
  const list = templateList(manifest);
  return Object.fromEntries(
    TEMPLATE_KINDS.map((kind) => [
      kind,
      manifest.defaults?.[kind] ?? templatesOfKind(list, kind)[0]?.name ?? "default",
    ]),
  ) as Record<TemplateKind, string>;
}

export const kindOfNode = (type: "page" | "collection" | "item"): TemplateKind =>
  type === "collection" ? "listing" : type === "item" ? "item" : "page";
