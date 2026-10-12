import { ContentRenderer } from "~/components/front/content-renderer";
import { ResponsiveImage } from "~/components/front/responsive-image";
import { Breadcrumbs } from "./components/breadcrumbs";
import { SiteShell } from "./components/site-shell";
import type { TemplateProps } from "./types";

export default function ArticleTemplate({ page }: TemplateProps) {
  const { translation, media, lang } = page;
  const cover = translation.ogImageId ? media[translation.ogImageId] : null;
  return (
    <SiteShell>
      <article className="mx-auto flex max-w-3xl flex-col gap-6 py-12">
        <Breadcrumbs items={page.breadcrumbs} />
        <header className="flex flex-col gap-3">
          {translation.publishedAt && (
            <time dateTime={translation.publishedAt} className="text-sm text-muted-foreground">
              {new Date(translation.publishedAt).toLocaleDateString(lang, { dateStyle: "long" })}
            </time>
          )}
          <h1 className="text-4xl font-semibold tracking-tight">{translation.title}</h1>
          {translation.excerpt && <p className="text-lg text-muted-foreground">{translation.excerpt}</p>}
        </header>
        {cover && <ResponsiveImage media={cover} lang={lang} loading="eager" className="w-full rounded-lg" />}
        <div className="prose prose-neutral max-w-none dark:prose-invert">
          <ContentRenderer doc={translation.content} media={media} lang={lang} />
        </div>
      </article>
    </SiteShell>
  );
}
