import { CopyIcon, EllipsisIcon, EyeIcon, EyeOffIcon, GripVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { t } from "~/admin/i18n";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { SectionSchema } from "~/lib/theme/sections";
import { cn } from "~/lib/utils";
import { allowedTypes, sameList, type EditorDoc, type ListRef, type RawNode } from "./model";

type Drag = { file: string; id: string; type: string };

type Props = {
  doc: EditorDoc;
  schemas: Record<string, SectionSchema>;
  selectedId: string | null;
  onSelect: (file: string, id: string) => void;
  onInsert: (ref: ListRef, index: number, type: string) => void;
  onMove: (from: { file: string; id: string }, to: ListRef, index: number) => void;
  onRemove: (file: string, id: string) => void;
  onDuplicate: (file: string, id: string) => void;
  onToggleHidden: (file: string, id: string) => void;
};

/** Albero di un file (template o gruppo) con trascinamento tra liste e slot. */
export function SectionTree(props: Props & { file: string }) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<{ ref: ListRef; index: number } | null>(null);
  const tree = props.doc.trees[props.file];
  if (!tree) return null;
  const dnd = { drag, setDrag, drop, setDrop };
  return (
    <TreeList
      {...props}
      dnd={dnd}
      listRef={{ file: props.file, parentId: null, slot: null }}
      nodes={tree.sections}
      depth={0}
    />
  );
}

type Dnd = {
  drag: Drag | null;
  setDrag: (d: Drag | null) => void;
  drop: { ref: ListRef; index: number } | null;
  setDrop: (d: { ref: ListRef; index: number } | null) => void;
};

function TreeList({
  nodes,
  listRef,
  depth,
  dnd,
  ...props
}: Props & { file: string; nodes: RawNode[]; listRef: ListRef; depth: number; dnd: Dnd }) {
  const allowed = allowedTypes(props.schemas, props.doc, listRef);
  const accepts = (type: string) => allowed.some((s) => s.name === type);
  const isTarget = (index: number) => dnd.drop && sameList(dnd.drop.ref, listRef) && dnd.drop.index === index;

  const finish = () => {
    if (dnd.drag && dnd.drop && accepts(dnd.drag.type))
      props.onMove({ file: dnd.drag.file, id: dnd.drag.id }, dnd.drop.ref, dnd.drop.index);
    dnd.setDrag(null);
    dnd.setDrop(null);
  };

  return (
    <div className="flex flex-col">
      {nodes.map((node, index) => (
        <div key={node.id}>
          {isTarget(index) && <DropLine depth={depth} />}
          <NodeRow
            {...props}
            node={node}
            depth={depth}
            dragging={dnd.drag?.id === node.id}
            onDragStart={() => dnd.setDrag({ file: listRef.file, id: node.id, type: node.type })}
            onDragEnd={() => {
              dnd.setDrag(null);
              dnd.setDrop(null);
            }}
            onDragOver={(event) => {
              if (!dnd.drag || !accepts(dnd.drag.type)) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              const after = event.clientY > rect.top + rect.height / 2;
              dnd.setDrop({ ref: listRef, index: after ? index + 1 : index });
            }}
            onDrop={(event) => {
              event.preventDefault();
              finish();
            }}
          />
          {Object.entries(props.schemas[node.type]?.slots ?? {}).map(([slot, def]) => (
            <div key={slot} className="flex flex-col" style={{ paddingLeft: (depth + 1) * 14 }}>
              <span className="px-2 pt-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {def.label ?? slot}
              </span>
              <TreeList
                {...props}
                dnd={dnd}
                listRef={{ file: listRef.file, parentId: node.id, slot }}
                nodes={node.slots[slot] ?? []}
                depth={0}
              />
            </div>
          ))}
        </div>
      ))}
      {isTarget(nodes.length) && <DropLine depth={depth} />}
      <div
        // Zona di rilascio in fondo alla lista (anche vuota).
        onDragOver={(event) => {
          if (!dnd.drag || !accepts(dnd.drag.type)) return;
          event.preventDefault();
          dnd.setDrop({ ref: listRef, index: nodes.length });
        }}
        onDrop={(event) => {
          event.preventDefault();
          finish();
        }}
      >
        <AddSection types={allowed} onAdd={(type) => props.onInsert(listRef, nodes.length, type)} />
      </div>
    </div>
  );
}

function DropLine({ depth }: { depth: number }) {
  return <div className="my-0.5 h-0.5 rounded-full bg-sky-500" style={{ marginLeft: depth * 14 + 8 }} />;
}

function NodeRow({
  node,
  depth,
  dragging,
  file,
  schemas,
  selectedId,
  onSelect,
  onRemove,
  onDuplicate,
  onToggleHidden,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: Props & {
  file: string;
  node: RawNode;
  depth: number;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
}) {
  const schema = schemas[node.type];
  const selected = selectedId === node.id;
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", node.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "group flex items-center gap-1 rounded-md pr-1 text-sm hover:bg-muted",
        selected && "bg-sky-500/10 text-foreground ring-1 ring-sky-500/40",
        dragging && "opacity-40",
        node.hidden && "text-muted-foreground",
      )}
      style={{ paddingLeft: depth * 14 }}
    >
      <GripVerticalIcon className="size-3.5 shrink-0 cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100" />
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col py-1.5 text-left"
        onClick={() => onSelect(file, node.id)}
      >
        <span className={cn("truncate", node.hidden && "line-through")}>{schema?.label ?? node.type}</span>
        {!schema && <span className="text-xs text-destructive">{t("visual.missingSection")}</span>}
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        className={cn(!node.hidden && "opacity-0 group-hover:opacity-100")}
        onClick={() => onToggleHidden(file, node.id)}
        aria-label={node.hidden ? t("visual.show") : t("visual.hide")}
      >
        {node.hidden ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="opacity-0 group-hover:opacity-100 data-[popup-open]:opacity-100"
              aria-label={t("common.actions")}
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem onClick={() => onDuplicate(file, node.id)}>
            <CopyIcon />
            {t("visual.duplicate")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => onRemove(file, node.id)}>
            <Trash2Icon />
            {t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function AddSection({ types, onAdd }: { types: SectionSchema[]; onAdd: (type: string) => void }) {
  if (!types.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="xs" className="my-0.5 self-start text-muted-foreground" />}
      >
        <PlusIcon data-icon="inline-start" />
        {t("visual.addSection")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("visual.addSection")}</DropdownMenuLabel>
          {types.map((schema) => (
            <DropdownMenuItem key={schema.name} onClick={() => onAdd(schema.name)}>
              <div className="flex flex-col">
                <span>{schema.label}</span>
                {schema.description && <span className="text-xs text-muted-foreground">{schema.description}</span>}
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
