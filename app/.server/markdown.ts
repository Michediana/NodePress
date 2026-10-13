import { Node } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import type { ContentDoc, ContentNode } from "~/lib/content";

// Conversione tra Markdown e contenuto Tiptap, per chi scrive i contenuti da fuori (server MCP).
// I blocchi senza equivalente Markdown viaggiano come commento HTML con gli attributi in JSON,
// così una lettura seguita da una scrittura non perde nulla:
//   ![Testo alternativo](media:12 "Didascalia")       → immagine della media library
//   <!-- np:gallery {"images":[{"mediaId":3}]} -->     → galleria, embed, sezione del tema
//   altro HTML                                          → blocco HTML

const BLOCK_COMMENT = /^<!--\s*np:(gallery|embed|section)\s+([\s\S]*?)\s*-->\s*$/;

const ImageNode = Node.create({
  name: "image",
  group: "block",
  atom: true,
  addAttributes: () => ({
    mediaId: { default: null },
    src: { default: "" },
    alt: { default: "" },
    caption: { default: "" },
  }),
  markdownTokenName: "image",
  parseMarkdown: (token, helpers) => {
    const id = /^media:(\d+)$/.exec(String(token.href ?? "").trim())?.[1];
    if (!id) return helpers.createTextNode(String(token.text ?? ""));
    return helpers.createNode("image", {
      mediaId: Number(id),
      src: "",
      alt: String(token.text ?? ""),
      caption: String(token.title ?? ""),
    });
  },
  renderMarkdown: (node) => {
    const { mediaId, alt, caption } = node.attrs ?? {};
    const title = caption ? ` "${String(caption).replace(/"/g, "'")}"` : "";
    return `![${String(alt ?? "").replace(/[[\]]/g, "")}](media:${mediaId}${title})`;
  },
});

/** Blocchi atomici serializzati come commento `<!-- np:<tipo> {…} -->`. */
const commentBlock = (name: string, attrs: Record<string, unknown>) =>
  Node.create({
    name,
    group: "block",
    atom: true,
    addAttributes: () => Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { default: v }])),
    renderMarkdown: (node) => `<!-- np:${name} ${JSON.stringify(node.attrs ?? {})} -->`,
  });

const HtmlNode = Node.create({
  name: "html",
  group: "block",
  atom: true,
  addAttributes: () => ({ html: { default: "" } }),
  markdownTokenName: "html",
  parseMarkdown: (token, helpers) => {
    const raw = String(token.raw ?? token.text ?? "").trim();
    const match = BLOCK_COMMENT.exec(raw);
    if (match) {
      try {
        return helpers.createNode(match[1], JSON.parse(match[2]));
      } catch {
        // JSON non valido: resta un blocco HTML.
      }
    }
    return helpers.createNode("html", { html: raw });
  },
  renderMarkdown: (node) => String(node.attrs?.html ?? ""),
});

const manager = new MarkdownManager({
  extensions: [
    // Come l'editor del pannello: titoli h2–h4, niente codice.
    StarterKit.configure({ codeBlock: false, code: false }),
    ImageNode,
    HtmlNode,
    commentBlock("gallery", { images: [] }),
    commentBlock("embed", { url: "" }),
    commentBlock("section", { id: null, section: "", settings: {}, previews: {} }),
  ],
});

const BLOCK_TYPES = new Set(["image", "gallery", "embed", "section", "html"]);

/** Riporta i blocchi finiti dentro un paragrafo (es. un'immagine su una riga) al livello dei blocchi. */
function liftBlocks(nodes: ContentNode[] = []): ContentNode[] {
  const out: ContentNode[] = [];
  for (const node of nodes) {
    if (node.type === "paragraph" && node.content?.some((c) => BLOCK_TYPES.has(c.type))) {
      let inline: ContentNode[] = [];
      const flush = () => {
        if (inline.some((c) => c.type !== "text" || c.text?.trim())) out.push({ ...node, content: inline });
        inline = [];
      };
      for (const child of node.content) {
        if (BLOCK_TYPES.has(child.type)) {
          flush();
          out.push(child);
        } else inline.push(child);
      }
      flush();
      continue;
    }
    if (node.type === "heading") {
      // L'editor ammette solo h2–h4: un "# Titolo" diventa h2.
      const level = Number(node.attrs?.level ?? 2);
      node.attrs = { ...node.attrs, level: Math.min(4, Math.max(2, level)) };
    }
    out.push(node.content && !BLOCK_TYPES.has(node.type) ? { ...node, content: liftBlocks(node.content) } : node);
  }
  return out;
}

export function markdownToDoc(markdown: string): ContentDoc {
  const doc = manager.parse(markdown) as ContentDoc;
  const content = liftBlocks(doc.content);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

export function docToMarkdown(doc: ContentDoc | null | undefined): string {
  if (!doc?.content?.length) return "";
  return manager.serialize(doc);
}
