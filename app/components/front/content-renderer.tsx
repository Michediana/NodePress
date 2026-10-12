import { Fragment } from "react";
import type { ContentDoc, ContentMark, ContentNode } from "~/lib/content";
import { embedSrc } from "~/lib/embed";
import type { MediaRef } from "~/lib/media";
import { isExternalUrl, safeUrl } from "~/lib/url";
import { ResponsiveImage } from "./responsive-image";

type Ctx = { media: Record<number, MediaRef>; lang: string };

function applyMarks(text: React.ReactNode, marks: ContentMark[] = []) {
  return marks.reduce<React.ReactNode>((child, mark) => {
    switch (mark.type) {
      case "bold":
        return <strong>{child}</strong>;
      case "italic":
        return <em>{child}</em>;
      case "underline":
        return <u>{child}</u>;
      case "strike":
        return <s>{child}</s>;
      case "code":
        return <code>{child}</code>;
      case "link": {
        const href = safeUrl(mark.attrs?.href) || "#";
        const external = isExternalUrl(href);
        return (
          <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {child}
          </a>
        );
      }
      default:
        return child;
    }
  }, text);
}

function renderChildren(nodes: ContentNode[] | undefined, ctx: Ctx) {
  return (nodes ?? []).map((node, i) => <Fragment key={i}>{renderNode(node, ctx)}</Fragment>);
}

function renderNode(node: ContentNode, ctx: Ctx): React.ReactNode {
  switch (node.type) {
    case "text":
      return applyMarks(node.text ?? "", node.marks);
    case "paragraph":
      return <p>{renderChildren(node.content, ctx)}</p>;
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 2, 2), 6);
      const Tag = `h${level}` as "h2";
      return <Tag>{renderChildren(node.content, ctx)}</Tag>;
    }
    case "blockquote":
      return <blockquote>{renderChildren(node.content, ctx)}</blockquote>;
    case "bulletList":
      return <ul>{renderChildren(node.content, ctx)}</ul>;
    case "orderedList":
      return <ol start={Number(node.attrs?.start) || undefined}>{renderChildren(node.content, ctx)}</ol>;
    case "listItem":
      return <li>{renderChildren(node.content, ctx)}</li>;
    case "hardBreak":
      return <br />;
    case "horizontalRule":
      return <hr />;
    case "image": {
      const media = ctx.media[Number(node.attrs?.mediaId)];
      const caption = String(node.attrs?.caption ?? "");
      const alt = String(node.attrs?.alt ?? "");
      if (!media) return null;
      return (
        <figure>
          <ResponsiveImage media={media} lang={ctx.lang} alt={alt} />
          {caption && <figcaption>{caption}</figcaption>}
        </figure>
      );
    }
    case "gallery": {
      const images = ((node.attrs?.images as { mediaId: number }[]) ?? [])
        .map((img) => ctx.media[img.mediaId])
        .filter(Boolean);
      return (
        <div className="np-gallery">
          {images.map((media) => (
            <ResponsiveImage key={media.id} media={media} lang={ctx.lang} sizes="(min-width: 640px) 33vw, 50vw" />
          ))}
        </div>
      );
    }
    case "embed": {
      const url = String(node.attrs?.url ?? "");
      const src = embedSrc(url);
      if (src) {
        return (
          <div className="np-embed">
            <iframe
              src={src}
              title="Video"
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        );
      }
      return url ? (
        <p>
          <a href={safeUrl(url) || "#"} target="_blank" rel="noopener noreferrer">
            {url}
          </a>
        </p>
      ) : null;
    }
    case "html":
      // Blocco HTML libero: inserito solo da utenti del pannello.
      return <div className="np-html" dangerouslySetInnerHTML={{ __html: String(node.attrs?.html ?? "") }} />;
    default:
      return renderChildren(node.content, ctx);
  }
}

/** Renderizza il JSON del contenuto (formato Tiptap) in componenti React. */
export function ContentRenderer({
  doc,
  media,
  lang,
}: {
  doc: ContentDoc | null;
  media: Record<number, MediaRef>;
  lang: string;
}) {
  if (!doc) return null;
  return <>{renderChildren(doc.content, { media, lang })}</>;
}
