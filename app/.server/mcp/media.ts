import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mediaUrl } from "~/lib/media";
import type { Media } from "../db/schema";
import { UserError } from "../forms";
import {
  createFolder,
  deleteMedia,
  getMedia,
  listFolders,
  listMedia,
  MAX_UPLOAD_BYTES,
  mediaCountsByFolder,
  moveMedia,
  renameMedia,
  updateMediaAlt,
  uploadMedia,
} from "../media";
import { getSetting } from "../settings";
import { addTool, type McpContext } from "./tools";

const FETCH_TIMEOUT = 30_000;
const MAX_REDIRECTS = 3;

const EXTENSION_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function mediaView(row: Media, base: string) {
  return {
    id: row.id,
    name: row.originalName,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    url: base + mediaUrl(row.file),
    alt: row.alt,
    folderId: row.folderId,
    createdAt: row.createdAt,
  };
}

/** Indirizzi non pubblici: un URL che punta qui potrebbe leggere servizi interni e pubblicarli come media. */
function isPrivateAddress(address: string) {
  const ip = address.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  return ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80");
}

async function assertPublicUrl(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UserError("Sono ammessi solo URL http e https.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (!addresses.length || addresses.some(isPrivateAddress))
    throw new UserError("L'URL punta a un indirizzo di rete privato: non è ammesso.");
}

/** Scarica un file da un URL pubblico, seguendo pochi redirect e controllando ogni destinazione. */
async function download(source: string) {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new UserError("URL non valido.");
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url);
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    const location = response.headers.get("Location");
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new UserError(`Download non riuscito: HTTP ${response.status}.`);
    if (Number(response.headers.get("Content-Length") ?? 0) > MAX_UPLOAD_BYTES)
      throw new UserError("Il file supera la dimensione massima di 100 MB.");
    const data = Buffer.from(await response.arrayBuffer());
    if (data.byteLength > MAX_UPLOAD_BYTES) throw new UserError("Il file supera la dimensione massima di 100 MB.");
    return { data, url, mime: response.headers.get("Content-Type") ?? "" };
  }
  throw new UserError("Troppi redirect.");
}

export function registerMediaTools(server: McpServer, ctx: McpContext) {
  const base = async () => (await getSetting("siteUrl")).trim().replace(/\/+$/, "") || ctx.origin;

  addTool(
    server,
    "media_list",
    {
      title: "Media library",
      description:
        "Elenco paginato dei file della media library, dal più recente. Le immagini si inseriscono nei contenuti con il loro id (Markdown: ![alt](media:<id>)).",
      readOnly: true,
      input: {
        q: z.string().optional().describe("Testo nel nome del file."),
        type: z.enum(["image", "video", "document"]).optional(),
        folderId: z
          .union([z.number().int(), z.literal("root")])
          .optional()
          .describe('Solo questa cartella ("root" = radice).'),
        page: z.number().int().min(1).default(1),
        perPage: z.number().int().min(1).max(100).default(30),
      },
    },
    async ({ folderId, ...args }) => {
      const result = await listMedia({ ...args, folderId: folderId === "root" ? null : folderId });
      const b = await base();
      return {
        page: args.page,
        perPage: args.perPage,
        total: result.total,
        items: result.items.map((m) => mediaView(m, b)),
      };
    },
  );

  addTool(
    server,
    "media_get",
    {
      title: "Dettaglio media",
      description: "Un file della media library.",
      readOnly: true,
      input: { id: z.number().int() },
    },
    async ({ id }) => {
      const row = await getMedia(id);
      if (!row) throw new UserError("Media non trovato.", 404);
      return { ...mediaView(row, await base()), variants: row.variants };
    },
  );

  addTool(
    server,
    "media_upload",
    {
      title: "Carica un media",
      description:
        "Aggiunge un file alla media library, scaricandolo da un URL pubblico oppure dal contenuto in base64. Le immagini vengono convertite (WEBP/AVIF), ridimensionate e ottengono le varianti per il srcset. Restituisce l'id da usare nei contenuti.",
      input: {
        url: z.string().optional().describe("URL http(s) pubblico del file."),
        base64: z.string().optional().describe("Contenuto del file in base64, in alternativa a url."),
        filename: z.string().max(255).optional().describe("Nome del file con estensione (obbligatorio con base64)."),
        mimeType: z.string().optional().describe("Tipo MIME; se manca si ricava dalla risposta o dall'estensione."),
        alt: z
          .record(z.string(), z.string().max(500))
          .optional()
          .describe("Testo alternativo per lingua: { it: '…', en: '…' }."),
        folderId: z.number().int().nullable().optional(),
      },
    },
    async (args) => {
      let data: Buffer;
      let name = args.filename;
      let mime = args.mimeType ?? "";
      if (args.url) {
        const result = await download(args.url);
        data = result.data;
        name ??= decodeURIComponent(path.posix.basename(result.url.pathname)) || "file";
        mime ||= result.mime;
      } else if (args.base64) {
        if (!name) throw new UserError("Con base64 serve filename.");
        data = Buffer.from(args.base64.replace(/^data:[^,]*,/, ""), "base64");
        if (data.byteLength > MAX_UPLOAD_BYTES) throw new UserError("Il file supera la dimensione massima di 100 MB.");
      } else {
        throw new UserError("Indica url oppure base64.");
      }
      mime =
        mime.split(";")[0].trim() || EXTENSION_TYPES[path.extname(name).toLowerCase()] || "application/octet-stream";
      const id = await uploadMedia(
        new File([new Uint8Array(data)], name, { type: mime }),
        ctx.user?.id ?? null,
        args.folderId ?? null,
      );
      if (args.alt) await updateMediaAlt(id, args.alt);
      return mediaView((await getMedia(id))!, await base());
    },
  );

  addTool(
    server,
    "media_update",
    {
      title: "Modifica un media",
      description: "Aggiorna testo alternativo (unito a quello esistente, per lingua), nome o cartella di un file.",
      input: {
        id: z.number().int(),
        alt: z.record(z.string(), z.string().max(500)).optional(),
        name: z.string().max(255).optional(),
        folderId: z.number().int().nullable().optional().describe("Cartella di destinazione; null = radice."),
      },
    },
    async ({ id, alt, name, folderId }) => {
      const row = await getMedia(id);
      if (!row) throw new UserError("Media non trovato.", 404);
      if (alt) await updateMediaAlt(id, { ...row.alt, ...alt });
      if (name !== undefined) await renameMedia(id, name);
      if (folderId !== undefined) await moveMedia([id], folderId);
      return mediaView((await getMedia(id))!, await base());
    },
  );

  addTool(
    server,
    "media_delete",
    {
      title: "Elimina un media",
      description:
        "Elimina definitivamente un file e le sue varianti dal disco. Chiedi conferma all'utente prima di usarlo.",
      destructive: true,
      input: { id: z.number().int() },
    },
    async ({ id }) => {
      if (!(await getMedia(id))) throw new UserError("Media non trovato.", 404);
      await deleteMedia(id);
      return { ok: true };
    },
  );

  addTool(
    server,
    "media_folders",
    {
      title: "Cartelle dei media",
      description: "Cartelle della media library, con il numero di file contenuti.",
      readOnly: true,
    },
    async () => {
      const [folders, counts] = await Promise.all([listFolders(), mediaCountsByFolder()]);
      return {
        rootCount: counts.root ?? 0,
        folders: folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, count: counts[f.id] ?? 0 })),
      };
    },
  );

  addTool(
    server,
    "media_folder_create",
    {
      title: "Crea una cartella",
      description: "Crea una cartella nella media library.",
      input: { name: z.string().min(1).max(255), parentId: z.number().int().nullable().default(null) },
    },
    async ({ name, parentId }) => ({ id: await createFolder(name, parentId, ctx.user?.id ?? null) }),
  );
}
