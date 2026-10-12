import type { SectionSchema, Visibility } from "~/lib/theme/sections";

// Modello dell'editor visuale: gli alberi JSON del tema (template e gruppi), i valori dei token
// e il CSS globale. Le funzioni sono pure: ogni modifica produce un nuovo documento, così
// annulla/ripeti è una pila di stati.

export type RawNode = {
  id: string;
  type: string;
  settings: Record<string, unknown>;
  slots: Record<string, RawNode[]>;
  hidden?: boolean;
  visibility?: Visibility;
  css?: string;
};

export type RawTree = { layout?: string | null; sections: RawNode[] };

export type EditorDoc = {
  /** Alberi per file: `templates/home.json`, `groups/header.json`… */
  trees: Record<string, RawTree>;
  /** Valori dei token scelti nell'editor (config/tokens.json). */
  tokens: Record<string, string>;
  /** CSS globale di override (config/custom.css). */
  css: string;
};

/** Posizione in cui inserire: lista principale dell'albero o slot di una sezione. */
export type ListRef = { file: string; parentId: string | null; slot: string | null };

export const sameList = (a: ListRef, b: ListRef) => a.file === b.file && a.parentId === b.parentId && a.slot === b.slot;

const fileBase = (file: string) => file.replace(/^(templates|groups)\//, "").replace(/\.json$/, "");

/**
 * Completa un albero letto dal tema: oggetti mancanti e id. Gli id mancanti sono gli stessi che
 * genera il compilatore (`home-0`, `home-0-actions-1`), così corrispondono all'anteprima.
 */
export function normalizeTree(file: string, raw: unknown): RawTree {
  const tree = (raw && typeof raw === "object" ? raw : {}) as Partial<RawTree>;
  const convert = (nodes: unknown, prefix: string): RawNode[] =>
    (Array.isArray(nodes) ? nodes : []).map((value, i) => {
      const node = value as Partial<RawNode>;
      const id = node.id ?? `${prefix}-${i}`;
      const slots: Record<string, RawNode[]> = {};
      for (const [slot, children] of Object.entries(node.slots ?? {})) slots[slot] = convert(children, `${id}-${slot}`);
      return { ...node, id, type: String(node.type ?? ""), settings: { ...(node.settings ?? {}) }, slots } as RawNode;
    });
  return {
    ...(tree.layout !== undefined ? { layout: tree.layout } : {}),
    sections: convert(tree.sections, fileBase(file)),
  };
}

/** JSON da salvare: niente oggetti vuoti superflui. */
export function serializeTree(tree: RawTree) {
  const clean = (nodes: RawNode[]): unknown[] =>
    nodes.map((node) => {
      const out: Record<string, unknown> = { id: node.id, type: node.type };
      if (Object.keys(node.settings).length) out.settings = node.settings;
      const slots = Object.fromEntries(Object.entries(node.slots).map(([k, v]) => [k, clean(v)]));
      if (Object.keys(slots).length) out.slots = slots;
      if (node.hidden) out.hidden = true;
      if (node.visibility && Object.values(node.visibility).some((v) => (Array.isArray(v) ? v.length : v)))
        out.visibility = node.visibility;
      if (node.css?.trim()) out.css = node.css;
      return out;
    });
  const out: Record<string, unknown> = {};
  if (tree.layout !== undefined) out.layout = tree.layout;
  out.sections = clean(tree.sections);
  return JSON.stringify(out, null, 2) + "\n";
}

type Found = { node: RawNode; list: RawNode[]; index: number; parent: RawNode | null; slot: string | null };

export function findNode(
  nodes: RawNode[],
  id: string,
  parent: RawNode | null = null,
  slot: string | null = null,
): Found | null {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node.id === id) return { node, list: nodes, index, parent, slot };
    for (const [name, children] of Object.entries(node.slots)) {
      const found = findNode(children, id, node, name);
      if (found) return found;
    }
  }
  return null;
}

/** File che contiene la sezione con quell'id; a parità, il file preferito (il template aperto). */
export function fileOfNode(doc: EditorDoc, id: string, prefer?: string) {
  if (prefer && doc.trees[prefer] && findNode(doc.trees[prefer].sections, id)) return prefer;
  return Object.keys(doc.trees).find((file) => findNode(doc.trees[file].sections, id)) ?? null;
}

function listOf(tree: RawTree, ref: ListRef): RawNode[] | null {
  if (!ref.parentId) return tree.sections;
  const parent = findNode(tree.sections, ref.parentId)?.node;
  if (!parent || !ref.slot) return null;
  return (parent.slots[ref.slot] ??= []);
}

/** Tutti gli id di un documento, per generarne di nuovi senza collisioni. */
function allIds(doc: EditorDoc) {
  const ids = new Set<string>();
  const walk = (nodes: RawNode[]) =>
    nodes.forEach((n) => {
      ids.add(n.id);
      Object.values(n.slots).forEach(walk);
    });
  Object.values(doc.trees).forEach((tree) => walk(tree.sections));
  return ids;
}

export function newId(doc: EditorDoc, type: string) {
  const ids = allIds(doc);
  let n = 1;
  while (ids.has(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}

/** Copia con id nuovi (per duplicare). */
function cloneWithIds(doc: EditorDoc, node: RawNode): RawNode {
  const ids = allIds(doc);
  const fresh = (type: string) => {
    let n = 1;
    while (ids.has(`${type}-${n}`)) n++;
    ids.add(`${type}-${n}`);
    return `${type}-${n}`;
  };
  const copy = (n: RawNode): RawNode => ({
    ...structuredClone(n),
    id: fresh(n.type),
    slots: Object.fromEntries(Object.entries(n.slots).map(([k, v]) => [k, v.map(copy)])),
  });
  return copy(node);
}

const edit = (doc: EditorDoc, fn: (draft: EditorDoc) => void) => {
  const draft = structuredClone(doc);
  fn(draft);
  return draft;
};

export const updateNode = (doc: EditorDoc, file: string, id: string, fn: (node: RawNode) => void) =>
  edit(doc, (draft) => {
    const found = findNode(draft.trees[file]?.sections ?? [], id);
    if (found) fn(found.node);
  });

export const insertNode = (doc: EditorDoc, ref: ListRef, index: number, node: RawNode) =>
  edit(doc, (draft) => {
    const list = draft.trees[ref.file] && listOf(draft.trees[ref.file], ref);
    list?.splice(Math.min(Math.max(index, 0), list.length), 0, node);
  });

export const removeNode = (doc: EditorDoc, file: string, id: string) =>
  edit(doc, (draft) => {
    const found = findNode(draft.trees[file]?.sections ?? [], id);
    found?.list.splice(found.index, 1);
  });

export function duplicateNode(doc: EditorDoc, file: string, id: string): { doc: EditorDoc; id: string | null } {
  const found = findNode(doc.trees[file]?.sections ?? [], id);
  if (!found) return { doc, id: null };
  const copy = cloneWithIds(doc, found.node);
  const next = edit(doc, (draft) => {
    const target = findNode(draft.trees[file].sections, id)!;
    target.list.splice(target.index + 1, 0, copy);
  });
  return { doc: next, id: copy.id };
}

/** Sposta una sezione in un'altra posizione (anche in un altro slot o file). */
export function moveNode(doc: EditorDoc, from: { file: string; id: string }, to: ListRef, index: number) {
  const found = findNode(doc.trees[from.file]?.sections ?? [], from.id);
  if (!found) return doc;
  // Non si può spostare una sezione dentro se stessa.
  if (to.parentId && (to.parentId === from.id || findNode(Object.values(found.node.slots).flat(), to.parentId)))
    return doc;
  return edit(doc, (draft) => {
    const source = findNode(draft.trees[from.file].sections, from.id)!;
    const [node] = source.list.splice(source.index, 1);
    const target = listOf(draft.trees[to.file], to);
    if (!target) return;
    // Nella stessa lista, togliere l'elemento sposta gli indici successivi.
    const sameParent = sameList({ file: from.file, parentId: source.parent?.id ?? null, slot: source.slot }, to);
    const at = sameParent && source.index < index ? index - 1 : index;
    target.splice(Math.min(Math.max(at, 0), target.length), 0, node);
  });
}

/** Tipi di sezione ammessi in una lista: tutti nell'albero, quelli di `accepts` negli slot. */
export function allowedTypes(schemas: Record<string, SectionSchema>, doc: EditorDoc, ref: ListRef) {
  if (!ref.parentId || !ref.slot) return Object.values(schemas);
  const parent = findNode(doc.trees[ref.file]?.sections ?? [], ref.parentId)?.node;
  const accepts = parent ? schemas[parent.type]?.slots[ref.slot]?.accepts : undefined;
  return Object.values(schemas).filter((s) => !accepts?.length || accepts.includes(s.name));
}
