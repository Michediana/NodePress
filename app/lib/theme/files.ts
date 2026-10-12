// Tipi di file del tema condivisi tra server e pannello.

export const TEXT_EXTENSIONS = new Set([".np", ".json", ".css", ".js", ".ts", ".md", ".txt", ".svg"]);

export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico"]);

const extOf = (file: string) => file.slice(file.lastIndexOf(".")).toLowerCase();

export const isTextFile = (file: string) => TEXT_EXTENSIONS.has(extOf(file));

export const isImageFile = (file: string) => IMAGE_EXTENSIONS.has(extOf(file));
