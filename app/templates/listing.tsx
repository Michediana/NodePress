import { Link } from "react-router";
import { ContentRenderer } from "~/components/front/content-renderer";
import { ResponsiveImage } from "~/components/front/responsive-image";
import { Breadcrumbs } from "./components/breadcrumbs";
import { SiteShell } from "./components/site-shell";
import type { TemplateProps } from "./types";

export default function ListingTemplate({ page }: TemplateProps) {
  const { translation, media, lang, listing } = page;
  const pageHref = (n: number) => (n === 1 ? page.url : `${page.url}?page=${n}`);
  return (
    <SiteShell>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs items={page.breadcrumbs} />
        <header className="flex flex-col gap-3">
          <h1 className="text-4xl font-semibold tracking-tight">{translation.title}</h1>
          {translation.content && (
            <div className="prose prose-neutral max-w-3xl dark:prose-invert">
              <ContentRenderer doc={translation.content} media={media} lang={lang} />
            </div>
          )}
        </header>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {listing?.items.map((item) => (
            <article key={item.id} className="flex flex-col gap-3">
              {item.image && (
                <Link to={item.url}>
                  <ResponsiveImage
                    media={item.image}
                    lang={lang}
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="aspect-video w-full rounded-lg object-cover"
                  />
                </Link>
              )}
              {item.publishedAt && (
                <time dateTime={item.publishedAt} className="text-sm text-muted-foreground">
                  {new Date(item.publishedAt).toLocaleDateString(lang, { dateStyle: "long" })}
                </time>
              )}
              <h2 className="text-xl font-semibold">
                <Link to={item.url} className="hover:underline">
                  {item.title}
                </Link>
              </h2>
              {item.excerpt && <p className="text-muted-foreground">{item.excerpt}</p>}
            </article>
          ))}
        </div>
        {listing && listing.pages > 1 && (
          <nav aria-label="Pagination" className="flex items-center justify-between border-t pt-6 text-sm">
            {listing.page > 1 ? (
              <Link to={pageHref(listing.page - 1)} rel="prev" className="underline-offset-4 hover:underline">
                ←
              </Link>
            ) : (
              <span />
            )}
            <span className="text-muted-foreground">
              {listing.page} / {listing.pages}
            </span>
            {listing.page < listing.pages ? (
              <Link to={pageHref(listing.page + 1)} rel="next" className="underline-offset-4 hover:underline">
                →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    </SiteShell>
  );
}
