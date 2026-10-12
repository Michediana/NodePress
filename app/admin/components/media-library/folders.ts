export type Folder = { id: number; name: string; parentId: number | null };

/** Tipo MIME usato nel drag & drop interno di file e cartelle. */
export const DRAG_TYPE = "application/x-nodepress-media";

export type DragPayload = { folders: number[]; media: number[] };

export function childrenOf(folders: Folder[], parentId: number | null) {
  return folders.filter((f) => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name, "it"));
}

/** Catena di cartelle dalla radice a `id` (inclusa). */
export function ancestorsOf(folders: Folder[], id: number | null) {
  const chain: Folder[] = [];
  const seen = new Set<number>();
  let current = folders.find((f) => f.id === id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = folders.find((f) => f.id === current!.parentId);
  }
  return chain;
}

/** Id di `id` e di tutte le sue sottocartelle. */
export function descendantsOf(folders: Folder[], id: number) {
  const ids = new Set([id]);
  for (let i = 0; i < folders.length; i++) {
    let added = false;
    for (const f of folders) {
      if (f.parentId !== null && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        added = true;
      }
    }
    if (!added) break;
  }
  return ids;
}

export function readDragPayload(e: React.DragEvent): DragPayload | null {
  const raw = e.dataTransfer.getData(DRAG_TYPE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

/** Il drag trasporta elementi interni o file dal computer? */
export function dragKind(e: React.DragEvent): "internal" | "files" | null {
  const types = e.dataTransfer.types;
  if (types.includes(DRAG_TYPE)) return "internal";
  if (types.includes("Files")) return "files";
  return null;
}
