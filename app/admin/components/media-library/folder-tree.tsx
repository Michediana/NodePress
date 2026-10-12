import { ChevronRightIcon, FolderIcon, FolderOpenIcon, LibraryIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "~/admin/i18n";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "~/components/ui/context-menu";
import { cn } from "~/lib/utils";
import { ancestorsOf, childrenOf, dragKind, type Folder } from "./folders";

type DropHandler = (target: number | null, e: React.DragEvent) => void;

/** Albero delle cartelle della libreria, con menu contestuale e destinazione di drop. */
export function FolderTree({
  folders,
  currentId,
  onOpen,
  onDrop,
  menu,
}: {
  folders: Folder[];
  currentId: number | null;
  onOpen: (id: number | null) => void;
  onDrop: DropHandler;
  /** Voci del menu contestuale per la cartella (null = radice). */
  menu: (target: Folder | null) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(ancestorsOf(folders, currentId).map((f) => f.id)));
  const [menuTarget, setMenuTarget] = useState<Folder | null>(null);
  const [dropTarget, setDropTarget] = useState<number | "root" | null>(null);

  // Quando si naviga in una cartella, i suoi antenati vengono aperti.
  useEffect(() => {
    const chain = ancestorsOf(folders, currentId);
    if (!chain.length) return;
    setExpanded((prev) => {
      if (chain.every((f) => prev.has(f.id))) return prev;
      const next = new Set(prev);
      for (const f of chain) next.add(f.id);
      return next;
    });
  }, [currentId, folders]);

  // Una cartella appena creata rende visibile il suo genitore.
  const known = useRef(new Set(folders.map((f) => f.id)));
  useEffect(() => {
    const added = folders.filter((f) => !known.current.has(f.id) && f.parentId !== null);
    known.current = new Set(folders.map((f) => f.id));
    if (added.length) setExpanded((prev) => new Set([...prev, ...added.map((f) => f.parentId!)]));
  }, [folders]);

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const dropProps = (target: number | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragKind(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = dragKind(e) === "files" ? "copy" : "move";
      setDropTarget(target ?? "root");
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDropTarget((prev) => (prev === (target ?? "root") ? null : prev));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(null);
      onDrop(target, e);
    },
  });

  const rowClass = (active: boolean, dropping: boolean) =>
    cn(
      "flex h-8 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
      active && "bg-muted font-medium",
      dropping && "bg-primary/10 ring-2 ring-primary",
    );

  function renderNode(folder: Folder, depth: number): React.ReactNode {
    const children = childrenOf(folders, folder.id);
    const open = expanded.has(folder.id);
    const active = folder.id === currentId;
    const Icon = active || open ? FolderOpenIcon : FolderIcon;
    return (
      <li key={folder.id} role="treeitem" aria-expanded={children.length ? open : undefined} aria-selected={active}>
        <div
          className={rowClass(active, dropTarget === folder.id)}
          style={{ paddingLeft: depth * 14 + 4 }}
          onContextMenu={() => setMenuTarget(folder)}
          {...dropProps(folder.id)}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label={folder.name}
            className={cn("flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground", !children.length && "invisible")}
            onClick={() => toggle(folder.id)}
          >
            <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 outline-none"
            onClick={() => onOpen(folder.id)}
            onDoubleClick={() => children.length && toggle(folder.id)}
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{folder.name}</span>
          </button>
        </div>
        {open && children.length > 0 && <ul role="group">{children.map((child) => renderNode(child, depth + 1))}</ul>}
      </li>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex min-h-full flex-col" onContextMenu={(e) => e.target === e.currentTarget && setMenuTarget(null)}>
        <ul role="tree" aria-label={t("media.folders")} className="flex flex-col gap-px">
          <li role="treeitem" aria-expanded aria-selected={currentId === null}>
            <button
              type="button"
              className={rowClass(currentId === null, dropTarget === "root")}
              style={{ paddingLeft: 4 }}
              onClick={() => onOpen(null)}
              onContextMenu={() => setMenuTarget(null)}
              {...dropProps(null)}
            >
              <span className="flex size-5 shrink-0 items-center justify-center">
                <LibraryIcon className="size-4 text-muted-foreground" />
              </span>
              <span className="truncate">{t("media.root")}</span>
            </button>
            <ul role="group">{childrenOf(folders, null).map((f) => renderNode(f, 1))}</ul>
          </li>
        </ul>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-48">{menu(menuTarget)}</ContextMenuContent>
    </ContextMenu>
  );
}

/** Elenco ad albero per scegliere una cartella di destinazione (es. "Sposta in…"). */
export function FolderPicker({
  folders,
  value,
  onChange,
  disabled,
}: {
  folders: Folder[];
  value: number | null;
  onChange: (id: number | null) => void;
  disabled?: Set<number>;
}) {
  const row = (id: number | null, label: string, depth: number, isDisabled: boolean, Icon: typeof FolderIcon) => (
    <button
      key={id ?? "root"}
      type="button"
      disabled={isDisabled}
      onClick={() => onChange(id)}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md pr-2 text-left text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-40",
        value === id && "bg-primary/10 font-medium text-primary hover:bg-primary/15",
      )}
      style={{ paddingLeft: depth * 16 + 8 }}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
  const walk = (parentId: number | null, depth: number, parentDisabled: boolean): React.ReactNode[] =>
    childrenOf(folders, parentId).flatMap((f) => {
      const isDisabled = parentDisabled || !!disabled?.has(f.id);
      return [row(f.id, f.name, depth, isDisabled, FolderIcon), ...walk(f.id, depth + 1, isDisabled)];
    });
  return (
    <div className="flex max-h-80 flex-col gap-px overflow-y-auto rounded-lg border p-1">
      {row(null, t("media.root"), 0, false, LibraryIcon)}
      {walk(null, 1, false)}
    </div>
  );
}
