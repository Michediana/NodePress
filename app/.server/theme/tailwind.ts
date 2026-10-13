import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Scanner } from "@tailwindcss/oxide";
import { compile } from "tailwindcss";
import { isTextFile } from "~/lib/theme/files";
import { ThemeCompileError } from "./compile";

// Tailwind CSS v4 facoltativo nei temi: un foglio in styles/ che importa "tailwindcss" passa da
// compile() prima della normale pipeline lightningcss. Le classi si estraggono da tutti i sorgenti
// del tema con lo scanner ufficiale, in memoria. Il server non esegue codice del tema: niente
// @plugin/@config (sarebbero moduli JS) e niente @source verso il filesystem; gli @import ammessi
// sono quelli di Tailwind stesso e i file CSS del tema.

/** Il foglio usa Tailwind: importa "tailwindcss" (o una sua parte) oppure ne usa le direttive. */
export const usesTailwind = (css: string) =>
  /@import\s+(url\()?\s*["']tailwindcss(\/[\w.-]+)?["']/.test(css) || /@(reference|tailwind)\s/.test(css);

const tailwindDir = path.dirname(path.dirname(createRequire(import.meta.url).resolve("tailwindcss")));

/** Fogli del pacchetto tailwindcss che si possono importare. */
const PACKAGE_SHEETS: Record<string, string> = {
  tailwindcss: "index.css",
  "tailwindcss/index.css": "index.css",
  "tailwindcss/theme": "theme.css",
  "tailwindcss/theme.css": "theme.css",
  "tailwindcss/preflight": "preflight.css",
  "tailwindcss/preflight.css": "preflight.css",
  "tailwindcss/utilities": "utilities.css",
  "tailwindcss/utilities.css": "utilities.css",
};

/**
 * Gli errori su un foglio Tailwind hanno posizioni nel CSS generato (o nessuna): li riporta alla riga
 * del sorgente in cui compare il nome citato nel messaggio (classe, file, URL), se c'è.
 */
export function locateInSource(error: ThemeCompileError, source: string) {
  const message = error.message.replace(/^.*? — /, "");
  const quoted = /[`"]([^`"]+)[`"]/.exec(message)?.[1];
  const index = quoted ? source.indexOf(quoted) : -1;
  if (index < 0) return new ThemeCompileError(message, error.file, 1, 1);
  const before = source.slice(0, index).split("\n");
  return new ThemeCompileError(message, error.file, before.length, before.at(-1)!.length + 1);
}

/**
 * Separa dal CSS generato i blocchi `@layer base { … }` di primo livello (il preflight di Tailwind e gli
 * stili di base dell'autore). La build li mette nel layer np.reset: nel layer del tema il preflight
 * vincerebbe sugli stili dei componenti del core (np.core), per esempio il banner dei cookie.
 */
export function splitBaseLayer(css: string) {
  const base: string[] = [];
  let rest = "";
  let i = 0;
  let depth = 0;
  let copied = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? css.length : end + 2;
    } else if (ch === '"' || ch === "'") {
      i++;
      while (i < css.length && css[i] !== ch) i += css[i] === "\\" ? 2 : 1;
      i++;
    } else if (ch === "{") {
      depth++;
      i++;
    } else if (ch === "}") {
      depth--;
      i++;
    } else if (depth === 0 && ch === "@") {
      const match = /^@layer\s+base\s*\{/.exec(css.slice(i, i + 32));
      if (!match) {
        i++;
        continue;
      }
      // Trova la graffa di chiusura del blocco, con le stesse regole per commenti e stringhe.
      const open = i + match[0].length;
      let j = open;
      let level = 1;
      while (j < css.length && level > 0) {
        const c = css[j];
        if (c === "/" && css[j + 1] === "*") {
          const end = css.indexOf("*/", j + 2);
          j = end < 0 ? css.length : end + 2;
          continue;
        }
        if (c === '"' || c === "'") {
          j++;
          while (j < css.length && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
        } else if (c === "{") level++;
        else if (c === "}") level--;
        j++;
      }
      base.push(css.slice(open, j - 1));
      rest += css.slice(copied, i);
      copied = i = j;
    } else i++;
  }
  rest += css.slice(copied);
  return { base: base.join("\n"), rest };
}

/** Estensione con cui lo scanner legge ogni tipo di file (il markup .np è simile all'HTML). */
const SCAN_AS: Record<string, string> = { ".np": "html", ".json": "json", ".js": "js", ".ts": "ts", ".md": "md" };

/** Classi candidate in tutti i sorgenti testuali del tema; quelle che non esistono vengono ignorate. */
export function scanCandidates(sources: Map<string, Buffer>) {
  const files = [...sources]
    .filter(([file]) => isTextFile(file) && SCAN_AS[path.posix.extname(file)])
    .map(([file, content]) => ({ content: content.toString("utf8"), extension: SCAN_AS[path.posix.extname(file)] }));
  return new Scanner({}).scanFiles(files);
}

/**
 * Compila un foglio con Tailwind e restituisce il CSS da passare a lightningcss.
 * Gli errori diventano ThemeCompileError sul file del tema. Con `sources` null (controllo mentre si
 * scrive, senza gli altri file) gli import relativi valgono come fogli vuoti.
 */
export async function compileTailwind(
  file: string,
  source: string,
  sources: Map<string, Buffer> | null,
  candidates: string[],
) {
  try {
    const compiler = await compile(source, {
      base: path.posix.dirname(file),
      async loadStylesheet(id, base) {
        const packaged = PACKAGE_SHEETS[id];
        if (packaged) {
          return {
            path: `tailwindcss/${packaged}`,
            base: "tailwindcss",
            content: await readFile(path.join(tailwindDir, packaged), "utf8"),
          };
        }
        if (id.startsWith(".") && base !== "tailwindcss") {
          const target = path.posix.normalize(path.posix.join(base, id));
          if (!sources) return { path: target, base: path.posix.dirname(target), content: "" };
          const content = sources.get(target);
          if (content && target.endsWith(".css") && !target.startsWith("..")) {
            return { path: target, base: path.posix.dirname(target), content: content.toString("utf8") };
          }
          throw new Error(`@import "${id}": file non trovato nel tema.`);
        }
        throw new Error(`@import "${id}" non ammesso: si possono importare solo "tailwindcss" e i file CSS del tema.`);
      },
      async loadModule(id) {
        throw new Error(`"${id}": @plugin e @config non sono ammessi nei temi (eseguirebbero codice sul server).`);
      },
    });
    return compiler.build(candidates);
  } catch (error) {
    if (error instanceof ThemeCompileError) throw error;
    throw new ThemeCompileError(`Tailwind: ${(error as Error).message}`, file, 1, 1);
  }
}
