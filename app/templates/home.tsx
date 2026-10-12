import { ContentRenderer } from "~/components/front/content-renderer";
import { SiteShell } from "./components/site-shell";
import type { TemplateProps } from "./types";

export default function HomeTemplate({ page }: TemplateProps) {
  const { translation, media, lang } = page;
  return (
    <SiteShell>
      <section className="flex flex-col gap-4 py-20">
        <h1 className="max-w-3xl text-5xl font-semibold tracking-tight">{translation.title}</h1>
        {translation.excerpt && <p className="max-w-2xl text-lg text-muted-foreground">{translation.excerpt}</p>}
      </section>
      <div className="prose prose-neutral max-w-3xl pb-16 dark:prose-invert">
        <ContentRenderer doc={translation.content} media={media} lang={lang} />
      </div>
    </SiteShell>
  );
}
