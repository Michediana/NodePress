import type { ComponentType } from "react";
import ArticleTemplate from "./article";
import DefaultTemplate from "./default";
import HomeTemplate from "./home";
import ListingTemplate from "./listing";
import type { TemplateProps } from "./types";

// Componenti dei template, indicizzati per nome (vedi registry.ts per i metadati).
const components: Record<string, ComponentType<TemplateProps>> = {
  default: DefaultTemplate,
  home: HomeTemplate,
  listing: ListingTemplate,
  article: ArticleTemplate,
};

export function getTemplate(name: string): ComponentType<TemplateProps> {
  return components[name] ?? DefaultTemplate;
}
