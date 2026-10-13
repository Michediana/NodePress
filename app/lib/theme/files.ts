// Tipi di file del tema condivisi tra server e pannello.

export const TEXT_EXTENSIONS = new Set([".np", ".json", ".css", ".js", ".ts", ".md", ".txt", ".svg"]);

export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico"]);

const extOf = (file: string) => file.slice(file.lastIndexOf(".")).toLowerCase();

export const isTextFile = (file: string) => TEXT_EXTENSIONS.has(extOf(file));

export const isImageFile = (file: string) => IMAGE_EXTENSIONS.has(extOf(file));

/**
 * File che l'editor visuale può scrivere: composizione (template e gruppi JSON), token e CSS di override.
 * Chi ha solo "themes.customize" modifica questi e nient'altro: niente markup, niente JS.
 */
export const isCustomizationFile = (file: string) =>
  // Nomi stretti: niente `..` né `\`, che normalizzati potrebbero puntare ad altri file.
  /^(templates|groups)\/[a-z0-9][a-z0-9-]*\.json$/.test(file) ||
  file === "config/tokens.json" ||
  file === "config/custom.css";
