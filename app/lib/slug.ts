/** Converte un testo in slug URL-safe (minuscolo, senza accenti, con trattini). */
export function slugify(input: string) {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 191);
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Percorso figlio dato il percorso del genitore (senza prefisso lingua). */
export function joinPath(parentPath: string | null, slug: string) {
  if (!parentPath || parentPath === "/") return slug ? `/${slug}` : "/";
  return `${parentPath}/${slug}`;
}
