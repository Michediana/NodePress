// Metadati dei template disponibili. Il markup è in `themes/<tema>/templates/<nome>.np`.
// Per aggiungere un template: crea il file nel tema, poi registralo qui.

export type TemplateKind = "page" | "listing" | "item";

export type TemplateMeta = { name: string; label: string; kinds: TemplateKind[] };

export const templates: TemplateMeta[] = [
  { name: "default", label: "Pagina standard", kinds: ["page", "item"] },
  { name: "home", label: "Home page", kinds: ["page"] },
  { name: "listing", label: "Elenco", kinds: ["listing"] },
  { name: "article", label: "Articolo", kinds: ["item"] },
];

export const templateKinds = (kind: TemplateKind) => templates.filter((t) => t.kinds.includes(kind));

export const defaultTemplate: Record<TemplateKind, string> = {
  page: "default",
  listing: "listing",
  item: "article",
};
