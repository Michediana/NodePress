import { FileIcon, FileTextIcon, FilmIcon } from "lucide-react";
import { isImage, mediaUrl, type MediaRef } from "~/lib/media";
import { cn } from "~/lib/utils";

/** Anteprima quadrata di un media (immagine o icona per il tipo di file). */
export function MediaThumb({ media, className }: { media: Pick<MediaRef, "file" | "mime" | "variants">; className?: string }) {
  const small = [...media.variants].sort((a, b) => a.width - b.width)[0];
  const Icon = media.mime.startsWith("video/") ? FilmIcon : media.mime === "application/pdf" ? FileTextIcon : FileIcon;
  return (
    <div className={cn("flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-muted", className)}>
      {isImage(media.mime) || media.mime === "image/svg+xml" ? (
        <img src={mediaUrl(small?.file ?? media.file)} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <Icon className="size-8 text-muted-foreground" />
      )}
    </div>
  );
}
