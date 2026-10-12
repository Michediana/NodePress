import { altFor, isImage, mediaUrl, srcSet, type MediaRef } from "~/lib/media";

/** Immagine con `srcset` generato dalle varianti (640, 1280, lato lungo massimo). */
export function ResponsiveImage({
  media,
  lang,
  alt,
  sizes = "(min-width: 1024px) 768px, 100vw",
  className,
  loading = "lazy",
}: {
  media: MediaRef;
  lang: string;
  alt?: string;
  sizes?: string;
  className?: string;
  loading?: "lazy" | "eager";
}) {
  const text = alt || altFor(media, lang);
  if (!isImage(media.mime)) {
    return <img src={mediaUrl(media.file)} alt={text} className={className} loading={loading} />;
  }
  return (
    <img
      src={mediaUrl(media.file)}
      srcSet={srcSet(media)}
      sizes={sizes}
      width={media.width ?? undefined}
      height={media.height ?? undefined}
      alt={text}
      loading={loading}
      decoding="async"
      className={className}
    />
  );
}
