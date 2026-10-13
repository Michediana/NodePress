#!/usr/bin/env node
// CLI di NodePress: sincronizza un tema tra il database e una cartella locale, per lavorarci
// dal proprio editor e con git. Parla solo con le API REST (API key con scope theme o admin), quindi
// funziona anche verso un'installazione remota. Nessuna dipendenza: gira con Node ≥ 22.18
// (TypeScript eseguito direttamente, solo annotazioni di tipo).
//
// La sincronizzazione è a tre vie: `.nodepress.json` ricorda l'hash di ogni file all'ultima
// sincronizzazione, così push e pull capiscono da che parte è avvenuta una modifica e non
// sovrascrivono in silenzio quelle fatte dall'altra (es. dall'editor visuale del pannello).

import { createHash } from "node:crypto";
import { existsSync, watch } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, styleText } from "node:util";

const CONFIG_FILE = ".nodepress.json";
const DEFAULT_URL = "http://localhost:5173";
const WATCH_DELAY = 200;

/** Estensioni ammesse nei file del tema (come THEME_FILE_TYPES nel server). */
const THEME_EXTENSIONS = new Set([
  ".np",
  ".json",
  ".css",
  ".js",
  ".ts",
  ".md",
  ".txt",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
]);

const HELP = `Uso: np theme <comando> [opzioni]

Comandi:
  list                          elenca i temi
  create <nome> [cartella]      crea un tema (--label, --from <tema> per duplicarne uno) e lo scarica
  pull <nome> [cartella]        scarica i sorgenti del tema nella cartella (default: ./<nome>)
  pull [cartella]               aggiorna una cartella già collegata
  push [cartella]               carica le modifiche locali nella bozza, con una sola ricompilazione
  watch [cartella]              push, poi carica ogni salvataggio
  publish [cartella]            pubblica la bozza

Opzioni:
  --url <url>      indirizzo di NodePress (oppure NODEPRESS_URL; default ${DEFAULT_URL})
  --key <key>      API key con scope theme o admin (oppure NODEPRESS_KEY)
  --theme <nome>   tema su cui lavorare, se diverso da quello collegato alla cartella
  --force          nei conflitti vince la parte che sta scrivendo (il locale con push/watch,
                   il server con pull); con push elimina anche i file presenti solo sul server
  -h, --help       mostra questo aiuto

La cartella ricorda server, tema e stato della sincronizzazione in ${CONFIG_FILE}
(la API key non viene mai salvata).`;

// --- Utilità ---

type Config = { url?: string; theme?: string; synced?: Record<string, string> };
type Snapshot = Map<string, string>; // percorso → sha256
type BuildOutcome = { buildId: number | null; error: BuildError | null };
type BuildError = { message: string; file: string | null; line: number | null; column: number | null };

class CliError extends Error {}

const ok = (text: string) => console.log(`${styleText("green", "✓")} ${text}`);
const warn = (text: string) => console.log(`${styleText("yellow", "!")} ${text}`);
const fail = (text: string) => console.error(`${styleText("red", "✗")} ${text}`);
const dim = (text: string) => styleText("dim", text);
const time = () => dim(new Date().toLocaleTimeString("it-IT"));

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function isThemeFile(rel: string) {
  if (rel.split("/").some((part) => part.startsWith(".") || part === "node_modules")) return false;
  return THEME_EXTENSIONS.has(path.posix.extname(rel).toLowerCase());
}

/** Percorso locale di un file del tema, senza uscire dalla cartella. */
function localPath(dir: string, rel: string) {
  const target = path.resolve(dir, rel);
  if (!target.startsWith(path.resolve(dir) + path.sep)) throw new CliError(`Percorso non valido: "${rel}".`);
  return target;
}

async function readConfig(dir: string): Promise<Config> {
  try {
    return JSON.parse(await readFile(path.join(dir, CONFIG_FILE), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new CliError(`${CONFIG_FILE} non valido: ${(error as Error).message}`);
  }
}

async function writeConfig(dir: string, config: Config) {
  const synced = Object.fromEntries(Object.entries(config.synced ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(path.join(dir, CONFIG_FILE), JSON.stringify({ ...config, synced }, null, 2) + "\n");
}

/** File del tema nella cartella, con il loro hash. */
async function scanLocal(dir: string, base = "", out: Snapshot = new Map()): Promise<Snapshot> {
  for (const entry of await readdir(path.join(dir, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    if (entry.isDirectory()) await scanLocal(dir, rel, out);
    else if (entry.isFile() && isThemeFile(rel)) out.set(rel, sha256(await readFile(path.join(dir, rel))));
  }
  return out;
}

async function hashLocal(dir: string, rel: string) {
  try {
    return sha256(await readFile(localPath(dir, rel)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Esegue `fn` su tutti gli elementi, al massimo `limit` alla volta. */
async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// --- Client delle API ---

class Api {
  url: string;
  key: string;
  constructor(url: string, key: string) {
    this.url = url.replace(/\/+$/, "");
    this.key = key;
  }

  async request(method: string, endpoint: string, body?: BodyInit, type?: string) {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.key}` };
    if (type) headers["Content-Type"] = type;
    let res: Response;
    try {
      res = await fetch(`${this.url}/api/v1/admin${endpoint}`, { method, headers, body });
    } catch (error) {
      throw new CliError(`Impossibile contattare ${this.url}: ${(error as Error).cause ?? (error as Error).message}`);
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const details = data?.details ? ` ${JSON.stringify(data.details)}` : "";
      throw new CliError(`${data?.error ?? res.statusText} (HTTP ${res.status})${details}`);
    }
    return res;
  }

  async json<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
    const res = await this.request(
      method,
      endpoint,
      body === undefined ? undefined : JSON.stringify(body),
      body === undefined ? undefined : "application/json",
    );
    return res.json() as Promise<T>;
  }

  themePath(theme: string, file = "") {
    const encoded = file.split("/").map(encodeURIComponent).join("/");
    return `/themes/${encodeURIComponent(theme)}${file ? `/files/${encoded}` : ""}`;
  }

  async remoteFiles(theme: string): Promise<Snapshot> {
    const data = await this.json<{ items: { path: string; hash: string }[] }>(
      "GET",
      `/themes/${encodeURIComponent(theme)}/files?hash`,
    );
    return new Map(data.items.map((item) => [item.path, item.hash]));
  }

  async download(theme: string, file: string) {
    return new Uint8Array(await (await this.request("GET", this.themePath(theme, file))).arrayBuffer());
  }

  /** Scrive ed elimina più file con un'unica ricompilazione della bozza. */
  async sync(theme: string, write: Map<string, Uint8Array<ArrayBuffer>>, remove: string[]) {
    const form = new FormData();
    for (const [file, content] of write) form.append(file, new Blob([content]), path.posix.basename(file));
    for (const file of remove) form.append("delete", file);
    const res = await this.request("POST", `/themes/${encodeURIComponent(theme)}/files`, form);
    return (await res.json()) as BuildOutcome;
  }
}

// --- Piano di sincronizzazione a tre vie ---

type Plan = {
  /** Da applicare nella direzione richiesta (contenuto atteso, `undefined` = eliminare). */
  apply: string[];
  /** Cambiati solo dall'altra parte: si lasciano come sono. */
  other: string[];
  /** Cambiati da entrambe le parti dall'ultima sincronizzazione. */
  conflicts: string[];
  /** Già identici. */
  same: string[];
};

/**
 * `source` è la parte che scrive (il locale per push, il server per pull), `target` quella che riceve.
 * Un file si applica se il target non è cambiato dall'ultima sincronizzazione; se è cambiato solo il
 * target lo si lascia; se sono cambiati entrambi è un conflitto.
 */
function plan(paths: Iterable<string>, source: Snapshot, target: Snapshot, base: Record<string, string>): Plan {
  const result: Plan = { apply: [], other: [], conflicts: [], same: [] };
  for (const file of new Set(paths)) {
    const s = source.get(file);
    const t = target.get(file);
    const b = base[file];
    if (s === t) result.same.push(file);
    else if (t === b) result.apply.push(file);
    else if (s === b) result.other.push(file);
    else result.conflicts.push(file);
  }
  for (const list of Object.values(result)) list.sort();
  return result;
}

function updateBase(base: Record<string, string>, files: string[], snapshot: Snapshot) {
  for (const file of files) {
    const hash = snapshot.get(file);
    if (hash) base[file] = hash;
    else delete base[file];
  }
}

function printBuild(outcome: BuildOutcome) {
  if (!outcome.error) {
    ok(`bozza aggiornata${outcome.buildId ? ` ${dim(`(build #${outcome.buildId})`)}` : ""}`);
    return true;
  }
  const { file, line, column, message } = outcome.error;
  const where = file ? `${file}${line ? `:${line}${column ? `:${column}` : ""}` : ""}` : "theme.json";
  fail(`il tema non compila, la bozza resta all'ultima build valida\n  ${styleText("bold", where)} ${message}`);
  return false;
}

// --- Contesto: cartella, server, key, tema ---

type Flags = { url?: string; key?: string; theme?: string; force?: boolean; label?: string; from?: string };

type Context = { dir: string; config: Config; api: Api; theme: string };

async function context(dirArg: string | undefined, flags: Flags, themeArg?: string): Promise<Context> {
  const dir = path.resolve(dirArg ?? (themeArg ? themeArg : "."));
  const config = existsSync(dir) ? await readConfig(dir) : {};
  const url = flags.url ?? process.env.NODEPRESS_URL ?? config.url ?? DEFAULT_URL;
  const key = flags.key ?? process.env.NODEPRESS_KEY;
  if (!key) throw new CliError("API key mancante: usa --key o la variabile NODEPRESS_KEY (scope theme o admin).");
  const theme = flags.theme ?? themeArg ?? config.theme;
  if (!theme) throw new CliError(`Nessun tema collegato a ${dir}: indica il nome (np theme pull <nome>) o --theme.`);
  // Cambiando server o tema lo stato della sincronizzazione precedente non vale più.
  const sameTarget = config.theme === theme && (config.url ?? DEFAULT_URL) === url;
  return {
    dir,
    config: { url, theme, synced: sameTarget ? (config.synced ?? {}) : {} },
    api: new Api(url, key),
    theme,
  };
}

// --- Comandi ---

async function list(flags: Flags) {
  const url = flags.url ?? process.env.NODEPRESS_URL ?? DEFAULT_URL;
  const key = flags.key ?? process.env.NODEPRESS_KEY;
  if (!key) throw new CliError("API key mancante: usa --key o la variabile NODEPRESS_KEY (scope theme o admin).");
  type Row = { name: string; label: string; active: boolean; publishedBuildId: number | null; buildError: unknown };
  const { items } = await new Api(url, key).json<{ items: Row[] }>("GET", "/themes");
  for (const t of items) {
    const tags = [
      t.active && styleText("green", "attivo"),
      !t.publishedBuildId && "mai pubblicato",
      t.buildError && styleText("red", "errori"),
    ]
      .filter(Boolean)
      .join(", ");
    console.log(`${styleText("bold", t.name.padEnd(24))} ${t.label}${tags ? dim(` — ${tags}`) : ""}`);
  }
}

async function pull(ctx: Context, force: boolean) {
  const { dir, api, theme, config } = ctx;
  await mkdir(dir, { recursive: true });
  const [remote, local] = await Promise.all([api.remoteFiles(theme), scanLocal(dir)]);
  const base = config.synced!;
  const p = plan([...remote.keys(), ...local.keys()], remote, local, base);
  const apply = force ? [...p.apply, ...p.conflicts] : p.apply;

  await eachLimit(apply, 8, async (file) => {
    const target = localPath(dir, file);
    if (remote.has(file)) {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await api.download(theme, file));
    } else {
      await rm(target, { force: true });
    }
  });
  updateBase(base, [...p.same, ...apply], remote);
  await writeConfig(dir, config);
  if (!existsSync(path.join(dir, ".gitignore"))) await writeFile(path.join(dir, ".gitignore"), `${CONFIG_FILE}\n`);

  const written = apply.filter((f) => remote.has(f)).length;
  const deleted = apply.length - written;
  const summary = [
    written && `${plural(written, "file scaricato", "file scaricati")}`,
    deleted && `${plural(deleted, "eliminato", "eliminati")}`,
  ]
    .filter(Boolean)
    .join(", ");
  if (summary || (!p.other.length && !p.conflicts.length))
    ok(`${theme} → ${path.relative(process.cwd(), dir) || "."}: ${summary || "già aggiornato"}`);
  if (p.other.length)
    warn(
      `${plural(p.other.length, "modifica locale non caricata", "modifiche locali non caricate")}: ${p.other.join(", ")}`,
    );
  reportConflicts(force ? [] : p.conflicts, "pull");
}

/** Carica nella bozza i file indicati (o tutti) secondo il piano a tre vie. */
async function push(ctx: Context, options: { force: boolean; only?: string[]; quiet?: boolean }) {
  const { dir, api, theme, config } = ctx;
  const base = config.synced!;
  const remote = await api.remoteFiles(theme);
  let local: Snapshot;
  let paths: string[];
  if (options.only) {
    local = new Map();
    for (const file of options.only) {
      const hash = await hashLocal(dir, file);
      if (hash) local.set(file, hash);
    }
    paths = options.only;
  } else {
    local = await scanLocal(dir);
    paths = [...local.keys(), ...remote.keys()];
  }
  const p = plan(paths, local, remote, base);
  // Con --force vince il locale, anche sui file presenti solo sul server (solo nel push completo).
  const forced = options.force ? p.conflicts.concat(options.only ? [] : p.other) : [];
  const apply = [...p.apply, ...forced];
  const write = new Map<string, Uint8Array<ArrayBuffer>>();
  const remove: string[] = [];
  for (const file of apply) {
    if (!local.has(file)) remove.push(file);
    else write.set(file, await readFile(localPath(dir, file)));
  }
  if (remove.includes("theme.json")) throw new CliError("theme.json non può essere eliminato dal server.");

  let built = true;
  if (apply.length) {
    const label = [write.size && [...write.keys()].join(", "), remove.length && `eliminati: ${remove.join(", ")}`]
      .filter(Boolean)
      .join("; ");
    console.log(`${time()} ${styleText("cyan", "↑")} ${label}`);
    built = printBuild(await api.sync(theme, write, remove));
  } else if (!options.quiet && !p.other.length && !p.conflicts.length) {
    ok(`${theme}: nessuna modifica da caricare`);
  }
  // Anche se il tema non compila i file sono salvati sul server: lo stato si aggiorna lo stesso.
  updateBase(base, [...p.same, ...apply], local);
  await writeConfig(dir, config);

  const remoteOnly = options.force ? [] : p.other.filter((f) => !local.has(f) && !(f in base));
  const remoteChanged = options.force ? [] : p.other.filter((f) => !remoteOnly.includes(f));
  if (remoteChanged.length)
    warn(`modificati sul server dall'ultima sincronizzazione (np theme pull): ${remoteChanged.join(", ")}`);
  if (remoteOnly.length && !options.only)
    warn(`solo sul server (np theme pull per scaricarli, push --force per eliminarli): ${remoteOnly.join(", ")}`);
  reportConflicts(options.force ? [] : p.conflicts, "push");
  return built;
}

function reportConflicts(conflicts: string[], command: "push" | "pull") {
  if (!conflicts.length) return;
  const winner = command === "push" ? "la versione locale" : "quella del server";
  fail(
    `conflitti, modificati sia in locale sia sul server: ${conflicts.join(", ")}\n  Risolvili a mano, oppure ripeti con --force per tenere ${winner}.`,
  );
  process.exitCode = 1;
}

async function watchDir(ctx: Context, force: boolean) {
  await push(ctx, { force });
  console.log(dim(`In ascolto su ${ctx.dir} (Ctrl+C per uscire)…`));

  const pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<void> | null = null;

  const flush = async () => {
    timer = null;
    if (running) return void (timer = setTimeout(() => void flush(), WATCH_DELAY));
    const files = [...pending];
    pending.clear();
    running = push(ctx, { force, only: files, quiet: true })
      .then(() => undefined)
      .catch((error) => fail((error as Error).message))
      .finally(() => (running = null));
    await running;
  };

  watch(ctx.dir, { recursive: true }, (_event, name) => {
    if (!name) return;
    const rel = name.toString().split(path.sep).join("/");
    if (!isThemeFile(rel)) return;
    pending.add(rel);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), WATCH_DELAY);
  });
  await new Promise(() => {});
}

async function publish(ctx: Context) {
  const { publishedBuildId } = await ctx.api.json<{ publishedBuildId: number }>(
    "POST",
    `/themes/${encodeURIComponent(ctx.theme)}/publish`,
    {},
  );
  ok(`${ctx.theme}: pubblicata la build #${publishedBuildId}`);
}

async function create(name: string, dirArg: string | undefined, flags: Flags) {
  const ctx = await context(dirArg, flags, name);
  if (existsSync(ctx.dir) && (await readdir(ctx.dir)).length) throw new CliError(`La cartella ${ctx.dir} non è vuota.`);
  const outcome = await ctx.api.json<BuildOutcome>("POST", "/themes", {
    name,
    label: flags.label ?? name,
    ...(flags.from ? { from: flags.from } : {}),
  });
  ok(`creato il tema ${name}${flags.from ? ` da ${flags.from}` : ""}`);
  printBuild(outcome);
  await pull(ctx, false);
}

// --- Avvio ---

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: "string" },
      key: { type: "string" },
      theme: { type: "string" },
      label: { type: "string" },
      from: { type: "string" },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [group, command, ...args] = positionals;
  if (values.help || group !== "theme" || !command) {
    console.log(HELP);
    if (!values.help) process.exitCode = 1;
    return;
  }
  const flags: Flags = values;
  const force = values.force ?? false;
  switch (command) {
    case "list":
      return list(flags);
    case "create":
      if (!args[0]) throw new CliError("Indica il nome del tema: np theme create <nome> [cartella].");
      return create(args[0], args[1], flags);
    case "pull": {
      // `pull <nome> [cartella]` oppure `pull [cartella]` su una cartella già collegata.
      const linked = args.length === 1 && existsSync(path.join(path.resolve(args[0]), CONFIG_FILE));
      const [theme, dir] = args.length === 0 || linked ? [undefined, args[0]] : [args[0], args[1]];
      return pull(await context(dir, flags, theme), force);
    }
    case "push":
      // Codice d'uscita 1 se il tema non compila, così `push && publish` si ferma.
      if (!(await push(await context(args[0], flags), { force }))) process.exitCode = 1;
      return;
    case "watch":
      return watchDir(await context(args[0], flags), force);
    case "publish":
      return publish(await context(args[0], flags));
    default:
      throw new CliError(`Comando sconosciuto: "${command}". Vedi np --help.`);
  }
}

main().catch((error) => {
  if (error instanceof CliError || (error as NodeJS.ErrnoException).code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
    fail(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
