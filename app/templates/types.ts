import type { PageData } from "~/components/front/site";

export type TemplatePage = PageData & { siteName: string; siteUrl: string };

export type TemplateProps = { page: TemplatePage };
