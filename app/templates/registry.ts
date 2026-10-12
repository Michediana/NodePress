// Metadati dei template disponibili. I componenti sono in `app/templates/index.ts`.
// Per aggiungere un template: crea il componente, poi registralo qui e in index.ts.

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
