import fs from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { resolveMediaPath } from "~/.server/media";
import type { Route } from "./+types/media-file";

const TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

export async function loader({ params }: Route.LoaderArgs) {
  let file: string;
  try {
    file = resolveMediaPath(params["*"] ?? "");
  } catch {
    throw new Response("Not found", { status: 404 });
  }
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat?.isFile()) throw new Response("Not found", { status: 404 });
  const ext = path.extname(file).toLowerCase();
  const headers = new Headers({
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "Content-Length": String(stat.size),
    // I nomi dei file contengono un suffisso casuale: possono essere cache "immutable".
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  // Gli SVG caricati dagli utenti non devono poter eseguire script.
  if (ext === ".svg") headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers });
}
