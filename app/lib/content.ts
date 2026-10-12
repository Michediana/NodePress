// Struttura JSON del contenuto (compatibile con il formato JSON di Tiptap/ProseMirror).

export type ContentMark = { type: string; attrs?: Record<string, unknown> };

export type ContentNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ContentNode[];
  marks?: ContentMark[];
  text?: string;
};

export type ContentDoc = { type: "doc"; content?: ContentNode[] };

export const emptyDoc = (): ContentDoc => ({ type: "doc", content: [{ type: "paragraph" }] });

/** Testo semplice estratto dal documento (per SEO, estratti, ricerca). */
export function docToText(node: ContentNode | ContentDoc | null | undefined): string {
  if (!node) return "";
  if (node.type === "text") return (node as ContentNode).text ?? "";
  const parts = (node.content ?? []).map((child) => docToText(child));
  const block = ["paragraph", "heading", "blockquote", "listItem"].includes(node.type);
  return parts.join(block ? "" : "\n").trim() + (block ? "\n" : "");
}

/** Visita ricorsivamente tutti i nodi del documento. */
export function walkDoc(node: ContentNode | ContentDoc | null | undefined, visit: (n: ContentNode) => void) {
  if (!node) return;
  visit(node as ContentNode);
  for (const child of node.content ?? []) walkDoc(child, visit);
}
