import {
  BracesIcon,
  ChevronRightIcon,
  CodeXmlIcon,
  EllipsisIcon,
  FileCodeIcon,
  FileIcon,
  FileJsonIcon,
  FolderIcon,
  ImageIcon,
  PaletteIcon,
  PencilIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { t } from "~/admin/i18n";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";

export type TreeFile = { path: string; size: number };

type Folder = { name: string; path: string; folders: Folder[]; files: TreeFile[] };

// Le cartelle convenzionali del tema vengono prima, nell'ordine in cui si usano.
const FOLDER_ORDER = ["templates", "components", "styles", "scripts", "assets"];

function buildTree(files: TreeFile[]): Folder {
  const root: Folder = { name: "", path: "", folders: [], files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let folder = root;
    parts.slice(0, -1).forEach((part, i) => {
      let next = folder.folders.find((f) => f.name === part);
      if (!next) {
        next = { name: part, path: parts.slice(0, i + 1).join("/"), folders: [], files: [] };
        folder.folders.push(next);
      }
      folder = next;
    });
    folder.files.push(file);
  }
  const sort = (folder: Folder) => {
    folder.folders.sort((a, b) => {
      const ia = FOLDER_ORDER.indexOf(a.name);
      const ib = FOLDER_ORDER.indexOf(b.name);
      if (folder.path === "" && (ia >= 0 || ib >= 0)) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.name.localeCompare(b.name);
    });
    folder.files.sort((a, b) => a.path.localeCompare(b.path));
    folder.folders.forEach(sort);
  };
  sort(root);
  return root;
}

function fileIcon(path: string) {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (ext === ".np") return CodeXmlIcon;
  if (ext === ".css") return PaletteIcon;
  if (ext === ".js" || ext === ".ts") return FileCodeIcon;
  if (ext === ".json") return path === "theme.json" ? BracesIcon : FileJsonIcon;
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico"].includes(ext)) return ImageIcon;
  if ([".woff", ".woff2", ".ttf", ".otf"].includes(ext)) return TypeIcon;
  return FileIcon;
}

type Props = {
  files: TreeFile[];
  active: string | null;
  dirty: Record<string, boolean>;
  errorFile: string | null;
  onOpen: (path: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
};

export function FileTree(props: Props) {
  const tree = useMemo(() => buildTree(props.files), [props.files]);
  return (
    <div className="flex flex-col py-1 text-sm">
      <FolderView folder={tree} depth={0} {...props} />
    </div>
  );
}

function FolderView({ folder, depth, ...props }: Props & { folder: Folder; depth: number }) {
  return (
    <>
      {folder.folders.map((child) => (
        <FolderNode key={child.path} folder={child} depth={depth} {...props} />
      ))}
      {folder.files.map((file) => (
        <FileNode key={file.path} file={file} depth={depth} {...props} />
      ))}
    </>
  );
}

function FolderNode({ folder, depth, ...props }: Props & { folder: Folder; depth: number }) {
  const [open, setOpen] = useState(true);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-muted-foreground hover:bg-muted"
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <ChevronRightIcon className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <FolderIcon className="size-3.5 shrink-0" />
        <span className="truncate">{folder.name}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <FolderView folder={folder} depth={depth + 1} {...props} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function FileNode({
  file,
  depth,
  active,
  dirty,
  errorFile,
  onOpen,
  onRename,
  onDelete,
}: Props & { file: TreeFile; depth: number }) {
  const Icon = fileIcon(file.path);
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);
  const isActive = active === file.path;
  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-sm pr-1 hover:bg-muted",
        isActive && "bg-muted font-medium text-foreground",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(file.path)}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
        style={{ paddingLeft: 8 + depth * 12 + 18 }}
        title={file.path}
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span
          className={cn(
            "truncate",
            errorFile === file.path && "text-destructive underline decoration-wavy underline-offset-2",
          )}
        >
          {name}
        </span>
        {dirty[file.path] && (
          <span className="size-1.5 shrink-0 rounded-full bg-foreground" aria-label={t("appearance.editor.unsaved")} />
        )}
      </button>
      {file.path !== "theme.json" && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 hover:bg-background group-hover:opacity-100 data-[popup-open]:opacity-100"
            aria-label={t("common.actions")}
          >
            <EllipsisIcon className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-40">
            <DropdownMenuItem onClick={() => onRename(file.path)}>
              <PencilIcon />
              {t("appearance.editor.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(file.path)}>
              <Trash2Icon />
              {t("appearance.editor.deleteFile")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
