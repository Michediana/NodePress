import { ContentRenderer } from "~/components/front/content-renderer";
import { Breadcrumbs } from "./components/breadcrumbs";
import { SiteShell } from "./components/site-shell";
import type { TemplateProps } from "./types";

export default function DefaultTemplate({ page }: TemplateProps) {
  const { translation, media, lang } = page;
  return (
    <SiteShell>
      <article className="mx-auto flex max-w-3xl flex-col gap-6 py-12">
        <Breadcrumbs items={page.breadcrumbs} />
        <h1 className="text-4xl font-semibold tracking-tight">{translation.title}</h1>
        <div className="prose prose-neutral max-w-none dark:prose-invert">
          <ContentRenderer doc={translation.content} media={media} lang={lang} />
        </div>
      </article>
    </SiteShell>
  );
}
