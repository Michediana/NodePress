export type ContentStatus = "draft" | "published" | "scheduled";

/** Stato effettivo: un contenuto "programmato" con data passata è pubblicato. */
export function effectiveStatus(status: ContentStatus, publishedAt: Date | string | null, now = new Date()): ContentStatus {
  if (status === "draft") return "draft";
  const date = publishedAt ? new Date(publishedAt) : null;
  if (date && date > now) return "scheduled";
  return "published";
}
