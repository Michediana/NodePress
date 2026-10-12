export type MediaVariant = { width: number; height: number; file: string; size: number };

export type MediaRef = {
  id: number;
  file: string;
  mime: string;
  width: number | null;
  height: number | null;
  variants: MediaVariant[];
  alt: Record<string, string>;
};

export const mediaUrl = (file: string) => `/uploads/${file}`;

export const isImage = (mime: string) => mime.startsWith("image/") && mime !== "image/svg+xml";

/** Attributo `srcset` con le varianti ordinate per larghezza. */
export function srcSet(media: Pick<MediaRef, "variants">) {
  return [...media.variants]
    .sort((a, b) => a.width - b.width)
    .map((v) => `${mediaUrl(v.file)} ${v.width}w`)
    .join(", ");
}

export function altFor(media: Pick<MediaRef, "alt">, lang: string, defaultLang?: string) {
  return media.alt[lang] ?? (defaultLang ? media.alt[defaultLang] : undefined) ?? "";
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
