import {
  CheckSquareIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FilmIcon,
  FolderIcon,
  FolderInputIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  ImageIcon,
  InfoIcon,
  LayoutGridIcon,
  ListIcon,
  PencilIcon,
  TrashIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Form, Link, redirect, useFetcher, useNavigate } from "react-router";
import { toast } from "sonner";
import { requirePermission } from "~/.server/auth";
import { handleUserErrors, UserError } from "~/.server/forms";
import {
  createFolder,
  deleteFolders,
  deleteMedia,
  getMediaMany,
  listFolders,
  listMedia,
  mediaCountsByFolder,
  mediaInFolders,
  moveFolders,
  moveMedia,
  renameFolder,
  renameMedia,
  uploadMedia,
} from "~/.server/media";
import { FolderPicker, FolderTree } from "~/admin/components/media-library/folder-tree";
import {
  ancestorsOf,
  childrenOf,
  descendantsOf,
  DRAG_TYPE,
  dragKind,
  readDragPayload,
  type Folder,
} from "~/admin/components/media-library/folders";
import { useMarquee } from "~/admin/components/media-library/use-marquee";
import { IconLabel } from "~/admin/components/icon-label";
import { MediaThumb } from "~/admin/components/media-thumb";
import { PageHeader } from "~/admin/components/page-header";
import { pageParam, Pager } from "~/admin/components/pager";
import { useActionToast } from "~/admin/feedback";
import { t } from "~/admin/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { formatBytes, mediaUrl } from "~/lib/media";
import { can } from "~/lib/roles";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/library";

const PER_PAGE = 48;

export async function loader({ request, context }: Route.LoaderArgs) {
  requirePermission(context, "media.upload");
  const url = new URL(request.url);
  const page = pageParam(request);
  const q = url.searchParams.get("q") ?? "";
  const type = url.searchParams.get("type") ?? "";
  const folderParam = Number(url.searchParams.get("folder"));
  const folderId = Number.isInteger(folderParam) && folderParam > 0 ? folderParam : null;
  const [folders, counts] = await Promise.all([listFolders(), mediaCountsByFolder()]);
  if (folderId !== null && !folders.some((f) => f.id === folderId)) throw redirect("/admin/media");
  const result = await listMedia({ page, perPage: PER_PAGE, q, type, folderId });
  return {
    ...result,
    folders: folders.map(({ id, name, parentId }) => ({ id, name, parentId })),
    counts,
    folderId,
    page,
    perPage: PER_PAGE,
    q,
    type,
  };
}

const idList = (form: FormData, key: string) =>
  form
    .getAll(key)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

const folderValue = (form: FormData, key: string) => {
  const value = Number(form.get(key));
  return Number.isInteger(value) && value > 0 ? value : null;
};

export async function action({ request, context }: Route.ActionArgs) {
  const user = requirePermission(context, "media.upload");
  const manageAll = can(user.role, "media");
  return handleUserErrors(async () => {
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "upload");
    const assertOwn = (items: { uploadedBy: number | null }[]) => {
      if (!manageAll && items.some((m) => m.uploadedBy !== user.id)) throw new UserError(t("errors.forbidden"), 403);
    };

    switch (intent) {
      case "upload": {
        const files = form.getAll("files").filter((f): f is File => typeof f !== "string" && f.size > 0);
        if (!files.length) throw new UserError(t("media.noFiles"));
        const folderId = folderValue(form, "folder");
        const ids: number[] = [];
        for (const file of files) ids.push(await uploadMedia(file, user.id, folderId));
        return { message: t("media.uploaded", { count: ids.length }), ids };
      }
      case "createFolder": {
        const id = await createFolder(String(form.get("name") ?? ""), folderValue(form, "parent"), user.id);
        return { message: t("media.folderCreated"), id };
      }
      case "rename": {
        const id = Number(form.get("id"));
        const name = String(form.get("name") ?? "");
        if (form.get("kind") === "folder") await renameFolder(id, name);
        else {
          const items = await getMediaMany([id]);
          if (!items.length) throw new UserError(t("errors.notFound"), 404);
          assertOwn(items);
          await renameMedia(id, name);
        }
        return { message: t("media.renamed") };
      }
      case "move": {
        const folders = idList(form, "folders");
        const media = idList(form, "media");
        const target = folderValue(form, "target");
        await moveFolders(folders, target);
        await moveMedia(media, target);
        return { message: t("media.moved", { count: folders.length + media.length }) };
      }
      case "delete": {
        const folders = idList(form, "folders");
        const items = await getMediaMany(idList(form, "media"));
        assertOwn([...items, ...(await mediaInFolders(folders))]);
        for (const item of items) await deleteMedia(item.id);
        await deleteFolders(folders);
        return { message: t("media.deleted", { count: folders.length + items.length }) };
      }
      default:
        throw new UserError(t("errors.generic"));
    }
  });
}

type Item = Route.ComponentProps["loaderData"]["items"][number];
type Entry = { key: string; kind: "folder"; folder: Folder } | { key: string; kind: "media"; media: Item };
type Targets = { folders: number[]; media: number[] };
type DialogState =
  | { type: "newFolder"; parentId: number | null }
  | { type: "rename"; kind: "folder" | "media"; id: number; name: string }
  | { type: "move"; targets: Targets }
  | { type: "delete"; targets: Targets }
  | null;

type View = "grid" | "list";
const VIEW_KEY = "nodepress.media.view";
const LIST_COLUMNS =
  "grid grid-cols-[auto_2.25rem_minmax(0,1fr)] items-center gap-3 px-2 sm:grid-cols-[auto_2.25rem_minmax(0,1fr)_6rem] md:grid-cols-[auto_2.25rem_minmax(0,1fr)_10rem_8rem_6rem_6rem]";

const folderHref = (id: number | null) => (id === null ? "/admin/media" : `/admin/media?folder=${id}`);

function splitKeys(keys: Iterable<string>): Targets {
  const targets: Targets = { folders: [], media: [] };
  for (const key of keys) {
    const [kind, id] = key.split(":");
    (kind === "folder" ? targets.folders : targets.media).push(Number(id));
  }
  return targets;
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export default function MediaLibrary({ loaderData }: Route.ComponentProps) {
  const { folders, folderId: currentId, items, counts } = loaderData;
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher.data);
  const busy = fetcher.state !== "idle";
  const uploading = busy && fetcher.formData?.get("intent") === "upload";
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<number | null>(null);

  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  // Ultimo dialog aperto: ne mantiene il contenuto durante l'animazione di chiusura.
  const lastDialog = useRef<DialogState>(null);
  if (dialog) lastDialog.current = dialog;
  const shown = dialog ?? lastDialog.current;
  const [menuEntry, setMenuEntry] = useState<Entry | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [fileDragOver, setFileDragOver] = useState(false);
  const [view, setView] = useState<View>("grid");
  // La vista scelta è una preferenza locale del browser.
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === "list") setView("list");
    } catch {}
  }, []);
  const changeView = (next: View) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
  };

  const current = folders.find((f) => f.id === currentId) ?? null;
  const filtering = !!(loaderData.q || loaderData.type);
  const entries = useMemo<Entry[]>(() => {
    const q = loaderData.q.toLowerCase();
    const subfolders =
      loaderData.page === 1 && !loaderData.type
        ? childrenOf(folders, currentId).filter((f) => !q || f.name.toLowerCase().includes(q))
        : [];
    return [
      ...subfolders.map((folder) => ({ key: `folder:${folder.id}`, kind: "folder" as const, folder })),
      ...items.map((media) => ({ key: `media:${media.id}`, kind: "media" as const, media })),
    ];
  }, [folders, currentId, items, loaderData.page, loaderData.q, loaderData.type]);

  // Cambiando cartella o pagina la selezione riparte da zero; dopo un aggiornamento
  // si tengono solo gli elementi ancora visibili.
  useEffect(() => {
    setSelection(new Set());
    anchor.current = null;
  }, [currentId, loaderData.page]);
  useEffect(() => {
    setSelection((prev) => {
      const keys = new Set(entries.map((e) => e.key));
      const next = new Set([...prev].filter((k) => keys.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [entries]);

  // Chiude il dialog che ha avviato l'operazione quando questa va a buon fine.
  const closeOnSuccess = useRef(false);
  useEffect(() => {
    if (fetcher.state !== "idle" || !closeOnSuccess.current) return;
    closeOnSuccess.current = false;
    if (fetcher.data && !("error" in fetcher.data && fetcher.data.error)) setDialog(null);
  }, [fetcher.state, fetcher.data]);

  const submit = useCallback(
    (intent: string, values: Record<string, string | number | null | (string | number)[] | File[]>) => {
      const form = new FormData();
      form.set("intent", intent);
      for (const [key, value] of Object.entries(values)) {
        if (Array.isArray(value)) for (const v of value) form.append(key, v instanceof File ? v : String(v));
        else form.set(key, value === null ? "" : String(value));
      }
      closeOnSuccess.current = dialog !== null;
      fetcher.submit(form, { method: "post", encType: "multipart/form-data" });
    },
    [fetcher, dialog],
  );

  const upload = (files: File[], folder: number | null) => files.length && submit("upload", { files, folder });
  const move = (targets: Targets, target: number | null) => {
    const folderIds = targets.folders.filter((id) => id !== target);
    if (!folderIds.length && !targets.media.length) return;
    submit("move", { folders: folderIds, media: targets.media, target });
  };

  const open = (entry: Entry) =>
    navigate(entry.kind === "folder" ? folderHref(entry.folder.id) : `/admin/media/${entry.media.id}`);

  const selectOnly = (key: string) => {
    setSelection(new Set([key]));
    anchor.current = key;
  };
  const toggle = (key: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    anchor.current = key;
  };

  const handleClick = (e: React.MouseEvent, entry: Entry) => {
    if (e.shiftKey && anchor.current) {
      const from = entries.findIndex((x) => x.key === anchor.current);
      const to = entries.findIndex((x) => x.key === entry.key);
      const range = entries.slice(Math.min(from, to), Math.max(from, to) + 1).map((x) => x.key);
      setSelection((prev) => new Set([...(e.metaKey || e.ctrlKey ? prev : []), ...range]));
    } else if (e.metaKey || e.ctrlKey) toggle(entry.key);
    else selectOnly(entry.key);
  };

  const { box, onPointerDown } = useMarquee({ selection, onSelect: setSelection });

  /** Elementi su cui agisce un comando: la selezione se include l'elemento, altrimenti solo lui. */
  const targetsFor = (entry: Entry | null): Targets =>
    entry && !selection.has(entry.key) ? splitKeys([entry.key]) : splitKeys(selection);

  const askRename = (entry: Entry) =>
    setDialog(
      entry.kind === "folder"
        ? { type: "rename", kind: "folder", id: entry.folder.id, name: entry.folder.name }
        : { type: "rename", kind: "media", id: entry.media.id, name: entry.media.originalName },
    );

  // Scorciatoie da tastiera.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || dialog || document.querySelector("[role=menu]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection(new Set(entries.map((x) => x.key)));
      } else if (e.key === "Escape") setSelection(new Set());
      else if ((e.key === "Delete" || (e.key === "Backspace" && e.metaKey)) && selection.size) {
        e.preventDefault();
        setDialog({ type: "delete", targets: splitKeys(selection) });
      } else if (e.key === "F2" && selection.size === 1) {
        const entry = entries.find((x) => selection.has(x.key));
        if (entry) askRename(entry);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entries, selection, dialog]);

  const handleDrop = (target: number | null, e: React.DragEvent) => {
    const payload = readDragPayload(e);
    if (payload) return move(payload, target);
    upload([...e.dataTransfer.files], target);
  };

  const onDragStart = (e: React.DragEvent, entry: Entry) => {
    const keys = selection.has(entry.key) ? selection : new Set([entry.key]);
    if (!selection.has(entry.key)) selectOnly(entry.key);
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(splitKeys(keys)));
    e.dataTransfer.effectAllowed = "move";
    // Immagine di trascinamento sempre esplicita: dentro un contenitore `select-none` WebKit
    // altrimenti cattura l'intera schermata. Il fantasma resta sotto il cursore (e non fuori
    // schermo) perché Safari ricava l'immagine dall'area visibile dell'elemento.
    const ghost = document.createElement("div");
    ghost.textContent = keys.size > 1 ? t("media.selected", { count: keys.size }) : entryName(entry);
    ghost.className =
      "pointer-events-none fixed z-[9999] max-w-64 truncate rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground shadow";
    ghost.style.left = `${e.clientX + 8}px`;
    ghost.style.top = `${e.clientY + 8}px`;
    document.body.append(ghost);
    e.dataTransfer.setDragImage(ghost, -8, -8);
    setTimeout(() => ghost.remove());
  };

  /** Props per rendere un elemento (cartella o voce del breadcrumb) destinazione di drop. */
  const folderDropProps = (key: string, target: number | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragKind(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = dragKind(e) === "files" ? "copy" : "move";
      setDropKey(key);
      setFileDragOver(false);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDropKey((prev) => (prev === key ? null : prev));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropKey(null);
      handleDrop(target, e);
    },
  });

  const pickUpload = (folder: number | null) => {
    uploadTarget.current = folder;
    uploadRef.current?.click();
  };

  // --- Menu contestuali ---

  /** Voci per creare o caricare dentro `parentId` (null = radice). */
  function containerMenu(parentId: number | null) {
    return (
      <ContextMenuGroup>
        <ContextMenuItem onClick={() => setDialog({ type: "newFolder", parentId })}>
          <FolderPlusIcon />
          {t("media.newFolder")}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => pickUpload(parentId)}>
          <UploadIcon />
          {t("media.uploadHere")}
        </ContextMenuItem>
      </ContextMenuGroup>
    );
  }

  function folderMenu(folder: Folder | null, targets?: Targets) {
    if (!folder) return containerMenu(null);
    const scope = targets ?? { folders: [folder.id], media: [] };
    return (
      <>
        <ContextMenuGroup>
          <ContextMenuItem onClick={() => navigate(folderHref(folder.id))}>
            <FolderOpenIcon />
            {t("media.openItem")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setDialog({ type: "newFolder", parentId: folder.id })}>
            <FolderPlusIcon />
            {t("media.newSubfolder")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => pickUpload(folder.id)}>
            <UploadIcon />
            {t("media.uploadHere")}
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem onClick={() => setDialog({ type: "rename", kind: "folder", id: folder.id, name: folder.name })}>
            <PencilIcon />
            {t("media.rename")}
            <ContextMenuShortcut>F2</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setDialog({ type: "move", targets: scope })}>
            <FolderInputIcon />
            {t("media.moveTo")}
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => setDialog({ type: "delete", targets: scope })}>
          <TrashIcon />
          {t("common.delete")}
          <ContextMenuShortcut>Canc</ContextMenuShortcut>
        </ContextMenuItem>
      </>
    );
  }

  function entryMenu(entry: Entry | null) {
    if (!entry)
      return (
        <>
          {/* Area vuota: agisce sulla cartella aperta. */}
          {containerMenu(currentId)}
          {entries.length > 0 && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => setSelection(new Set(entries.map((x) => x.key)))}>
                <CheckSquareIcon />
                {t("media.selectAll")}
                <ContextMenuShortcut>⌘A</ContextMenuShortcut>
              </ContextMenuItem>
            </>
          )}
        </>
      );
    const targets = targetsFor(entry);
    const count = targets.folders.length + targets.media.length;
    if (count === 1 && entry.kind === "folder") return folderMenu(entry.folder);
    if (count > 1)
      return (
        <>
          <ContextMenuGroup>
            <ContextMenuLabel>{t("media.selected", { count })}</ContextMenuLabel>
            <ContextMenuItem onClick={() => setDialog({ type: "move", targets })}>
              <FolderInputIcon />
              {t("media.moveTo")}
            </ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => setDialog({ type: "delete", targets })}>
            <TrashIcon />
            {t("common.delete")}
            <ContextMenuShortcut>Canc</ContextMenuShortcut>
          </ContextMenuItem>
        </>
      );
    if (entry.kind !== "media") return null;
    const url = mediaUrl(entry.media.file);
    return (
      <>
        <ContextMenuGroup>
          <ContextMenuItem onClick={() => open(entry)}>
            <InfoIcon />
            {t("media.openItem")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => window.open(url, "_blank", "noopener")}>
            <ExternalLinkIcon />
            {t("media.openNewTab")}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() =>
              navigator.clipboard.writeText(new URL(url, window.location.origin).href).then(() => toast.success(t("common.copied")))
            }
          >
            <CopyIcon />
            {t("media.copyUrl")}
          </ContextMenuItem>
          <ContextMenuItem render={<a href={url} download={entry.media.originalName} />}>
            <DownloadIcon />
            {t("media.download")}
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem onClick={() => askRename(entry)}>
            <PencilIcon />
            {t("media.rename")}
            <ContextMenuShortcut>F2</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setDialog({ type: "move", targets })}>
            <FolderInputIcon />
            {t("media.moveTo")}
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => setDialog({ type: "delete", targets })}>
          <TrashIcon />
          {t("common.delete")}
          <ContextMenuShortcut>Canc</ContextMenuShortcut>
        </ContextMenuItem>
      </>
    );
  }

  const folderItemCount = (id: number) => (counts[id] ?? 0) + childrenOf(folders, id).length;
  const entryName = (entry: Entry) => (entry.kind === "folder" ? entry.folder.name : entry.media.originalName);
  const entryDetails = (entry: Entry) =>
    entry.kind === "folder"
      ? t("media.itemsCount", { count: folderItemCount(entry.folder.id) })
      : `${entry.media.width ? `${entry.media.width}×${entry.media.height} · ` : ""}${formatBytes(entry.media.size)}`;

  /** Attributi e gestori comuni a ogni elemento selezionabile, in griglia e in lista. */
  const entryProps = (entry: Entry, selected: boolean) => ({
    "data-entry": entry.key,
    role: "option",
    "aria-selected": selected,
    tabIndex: 0,
    draggable: true,
    title: entryName(entry),
    onClick: (e: React.MouseEvent) => handleClick(e, entry),
    onDoubleClick: () => open(entry),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter") open(entry);
      if (e.key === " ") {
        e.preventDefault();
        toggle(entry.key);
      }
    },
    onContextMenu: () => {
      if (!selected) selectOnly(entry.key);
      setMenuEntry(entry);
    },
    onDragStart: (e: React.DragEvent) => onDragStart(e, entry),
    onDragEnd: () => setDropKey(null),
    ...(entry.kind === "folder" ? folderDropProps(entry.key, entry.folder.id) : {}),
  });

  const selectBox = (entry: Entry, selected: boolean, className?: string) => (
    <Checkbox
      aria-label={`${t("media.select")} ${entryName(entry)}`}
      checked={selected}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onCheckedChange={() => toggle(entry.key)}
      className={className}
    />
  );

  const mediaTypes = [
    { value: "", label: <IconLabel icon={LayoutGridIcon}>{t("media.allTypes")}</IconLabel> },
    { value: "image", label: <IconLabel icon={ImageIcon}>{t("media.images")}</IconLabel> },
    { value: "video", label: <IconLabel icon={FilmIcon}>{t("media.videos")}</IconLabel> },
    { value: "document", label: <IconLabel icon={FileTextIcon}>{t("media.documents")}</IconLabel> },
  ];
  const crumbs = ancestorsOf(folders, currentId);
  const allSelected = entries.length > 0 && selection.size === entries.length;

  return (
    <>
      <PageHeader
        title={t("nav.media")}
        description={t("media.description")}
        actions={
          <>
            <input
              ref={uploadRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                upload([...(e.target.files ?? [])], uploadTarget.current);
                e.target.value = "";
              }}
            />
            <Button variant="outline" onClick={() => setDialog({ type: "newFolder", parentId: currentId })}>
              <FolderPlusIcon data-icon="inline-start" />
              {t("media.newFolder")}
            </Button>
            <Button disabled={uploading} onClick={() => pickUpload(currentId)}>
              {uploading ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
              {t("media.upload")}
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-3">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              {current ? (
                <BreadcrumbLink
                  render={<Link to={folderHref(null)} />}
                  className={cn("rounded px-1", dropKey === "crumb:root" && "bg-primary/10 ring-2 ring-primary")}
                  {...folderDropProps("crumb:root", null)}
                >
                  {t("media.root")}
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage className="px-1">{t("media.root")}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
            {crumbs.map((folder) => (
              <Fragment key={folder.id}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {folder.id === currentId ? (
                    <BreadcrumbPage className="px-1">{folder.name}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink
                      render={<Link to={folderHref(folder.id)} />}
                      className={cn("rounded px-1", dropKey === `crumb:${folder.id}` && "bg-primary/10 ring-2 ring-primary")}
                      {...folderDropProps(`crumb:${folder.id}`, folder.id)}
                    >
                      {folder.name}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex min-h-9 flex-wrap items-center gap-2">
          <Checkbox
            aria-label={t("media.selectAll")}
            checked={allSelected}
            indeterminate={selection.size > 0 && !allSelected}
            disabled={!entries.length}
            onCheckedChange={(checked) => setSelection(new Set(checked ? entries.map((x) => x.key) : []))}
            className="mx-1"
          />
          {selection.size > 0 ? (
            <>
              <span className="text-sm font-medium">{t("media.selected", { count: selection.size })}</span>
              <Button size="sm" variant="outline" onClick={() => setDialog({ type: "move", targets: splitKeys(selection) })}>
                <FolderInputIcon data-icon="inline-start" />
                {t("media.move")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDialog({ type: "delete", targets: splitKeys(selection) })}>
                <TrashIcon data-icon="inline-start" />
                {t("common.delete")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelection(new Set())}>
                <XIcon data-icon="inline-start" />
                {t("media.clearSelection")}
              </Button>
            </>
          ) : (
            <Form method="get" className="flex flex-1 flex-wrap gap-2">
              {currentId !== null && <input type="hidden" name="folder" value={currentId} />}
              <Input name="q" placeholder={t("common.search")} defaultValue={loaderData.q} className="max-w-xs" />
              <Select name="type" defaultValue={loaderData.type} items={mediaTypes}>
                <SelectTrigger className="min-w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {mediaTypes.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button type="submit" variant="outline">
                {t("common.filter")}
              </Button>
            </Form>
          )}
          <ToggleGroup
            variant="outline"
            size="sm"
            className="ml-auto"
            value={[view]}
            onValueChange={(value) => value[0] && changeView(value[0] as View)}
          >
            <ToggleGroupItem value="grid" aria-label={t("media.viewGrid")} title={t("media.viewGrid")}>
              <LayoutGridIcon />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label={t("media.viewList")} title={t("media.viewList")}>
              <ListIcon />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      <div className="grid flex-1 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="h-full rounded-xl border p-2">
            <div className="sticky top-2 max-h-[calc(100svh-1rem)] overflow-y-auto">
              <FolderTree
                folders={folders}
                currentId={currentId}
                onOpen={(id) => navigate(folderHref(id))}
                onDrop={handleDrop}
                menu={(folder) => folderMenu(folder)}
              />
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          <ContextMenu>
            <ContextMenuTrigger
              className={cn(
                "relative min-h-64 flex-1 rounded-xl outline-none",
                fileDragOver && "bg-primary/5 ring-2 ring-primary ring-dashed",
              )}
              onContextMenu={(e) => {
                if (!(e.target as HTMLElement).closest("[data-entry]")) setMenuEntry(null);
              }}
              onPointerDown={onPointerDown}
              onDragOver={(e) => {
                if (dragKind(e) !== "files") return;
                e.preventDefault();
                setFileDragOver(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileDragOver(false);
              }}
              onDrop={(e) => {
                if (dragKind(e) !== "files") return;
                e.preventDefault();
                setFileDragOver(false);
                upload([...e.dataTransfer.files], currentId);
              }}
            >
              {entries.length === 0 ? (
                <Empty className="pointer-events-none">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">{current ? <FolderOpenIcon /> : <ImageIcon />}</EmptyMedia>
                    <EmptyTitle>{filtering ? t("media.noResults") : current ? t("media.emptyFolder") : t("media.empty")}</EmptyTitle>
                    {!filtering && (
                      <EmptyDescription>{current ? t("media.emptyFolderDescription") : t("media.emptyDescription")}</EmptyDescription>
                    )}
                  </EmptyHeader>
                </Empty>
              ) : view === "grid" ? (
                <div
                  role="listbox"
                  aria-multiselectable
                  aria-label={t("nav.media")}
                  className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8"
                >
                  {entries.map((entry) => {
                    const selected = selection.has(entry.key);
                    return (
                      <div
                        key={entry.key}
                        {...entryProps(entry, selected)}
                        className={cn(
                          "group relative flex cursor-default flex-col gap-1 rounded-lg p-1.5 outline-none transition-colors select-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
                          selected && "bg-primary/10 hover:bg-primary/15",
                          dropKey === entry.key && "bg-primary/15 ring-2 ring-primary",
                        )}
                      >
                        <div className="relative">
                          {entry.kind === "folder" ? (
                            <div className="flex aspect-square items-center justify-center rounded-lg bg-muted">
                              <FolderIcon className="size-1/2 fill-primary/15 text-primary/70" strokeWidth={1.25} />
                            </div>
                          ) : (
                            <MediaThumb media={entry.media} className={cn(selected && "ring-2 ring-primary")} />
                          )}
                          {selectBox(
                            entry,
                            selected,
                            cn(
                              "absolute top-2 left-2 bg-background shadow-sm transition-opacity",
                              selected || selection.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                            ),
                          )}
                        </div>
                        <span className="truncate px-0.5 text-xs font-medium">{entryName(entry)}</span>
                        <span className="truncate px-0.5 text-xs text-muted-foreground">{entryDetails(entry)}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div role="listbox" aria-multiselectable aria-label={t("nav.media")} className="flex flex-col pb-8">
                  <div aria-hidden className={cn(LIST_COLUMNS, "border-b pb-2 text-xs font-medium text-muted-foreground")}>
                    <span />
                    <span />
                    <span>{t("media.name")}</span>
                    <span className="hidden md:block">{t("media.type")}</span>
                    <span className="hidden md:block">{t("media.dimensions")}</span>
                    <span className="hidden text-right sm:block">{t("media.size")}</span>
                    <span className="hidden text-right md:block">{t("media.date")}</span>
                  </div>
                  {entries.map((entry) => {
                    const selected = selection.has(entry.key);
                    return (
                      <div
                        key={entry.key}
                        {...entryProps(entry, selected)}
                        className={cn(
                          LIST_COLUMNS,
                          "cursor-default rounded-md py-1.5 text-sm outline-none transition-colors select-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
                          selected && "bg-primary/10 hover:bg-primary/15",
                          dropKey === entry.key && "bg-primary/15 ring-2 ring-primary",
                        )}
                      >
                        {selectBox(entry, selected, "bg-background")}
                        {entry.kind === "folder" ? (
                          <div className="flex size-9 items-center justify-center rounded-md bg-muted">
                            <FolderIcon className="size-5 fill-primary/15 text-primary/70" strokeWidth={1.5} />
                          </div>
                        ) : (
                          <MediaThumb media={entry.media} className="size-9 rounded-md [&_svg]:size-5" />
                        )}
                        <span className="truncate font-medium">{entryName(entry)}</span>
                        <span className="hidden truncate text-muted-foreground md:block">
                          {entry.kind === "folder" ? t("media.folder") : entry.media.mime}
                        </span>
                        <span className="hidden truncate text-muted-foreground md:block">
                          {entry.kind === "folder"
                            ? t("media.itemsCount", { count: folderItemCount(entry.folder.id) })
                            : entry.media.width
                              ? `${entry.media.width}×${entry.media.height}`
                              : "—"}
                        </span>
                        <span className="hidden text-right text-muted-foreground tabular-nums sm:block">
                          {entry.kind === "folder" ? "—" : formatBytes(entry.media.size)}
                        </span>
                        <span className="hidden text-right text-muted-foreground tabular-nums md:block">
                          {entry.kind === "folder" ? "—" : new Date(entry.media.createdAt).toLocaleDateString("it")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {fileDragOver && (
                <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
                  <span className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow">
                    {t("media.dropToUpload", { name: current?.name ?? t("media.root") })}
                  </span>
                </div>
              )}
            </ContextMenuTrigger>
            <ContextMenuContent className="min-w-52">{entryMenu(menuEntry)}</ContextMenuContent>
          </ContextMenu>
          <Pager page={loaderData.page} total={loaderData.total} perPage={loaderData.perPage} />
        </div>
      </div>

      {box && (
        <div
          className="pointer-events-none fixed z-50 rounded-sm border border-primary bg-primary/10"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        />
      )}

      <NameDialog
        open={dialog?.type === "newFolder" || dialog?.type === "rename"}
        title={
          shown?.type === "rename"
            ? t("media.renameTitle", { name: shown.name })
            : shown?.type === "newFolder" && shown.parentId !== null
              ? t("media.newSubfolder")
              : t("media.newFolder")
        }
        label={shown?.type === "rename" && shown.kind === "media" ? t("media.name") : t("media.folderName")}
        initial={shown?.type === "rename" ? shown.name : ""}
        submitLabel={shown?.type === "rename" ? t("media.rename") : t("media.create")}
        busy={busy}
        onClose={() => setDialog(null)}
        onSubmit={(name) => {
          if (dialog?.type === "newFolder") submit("createFolder", { name, parent: dialog.parentId });
          if (dialog?.type === "rename") submit("rename", { kind: dialog.kind, id: dialog.id, name });
        }}
      />

      <MoveDialog
        open={dialog?.type === "move"}
        state={shown?.type === "move" ? shown.targets : null}
        folders={folders}
        currentId={currentId}
        busy={busy}
        onClose={() => setDialog(null)}
        onSubmit={(targets, target) => move(targets, target)}
      />

      <AlertDialog open={dialog?.type === "delete"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          {shown?.type === "delete" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("media.deleteTitle", { count: shown.targets.folders.length + shown.targets.media.length })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {shown.targets.folders.length > 0 && <>{t("media.deleteFoldersWarning")} </>}
                  {t("media.deleteFilesWarning")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={busy}
                  onClick={() => submit("delete", { folders: shown.targets.folders, media: shown.targets.media })}
                >
                  {busy && <Spinner data-icon="inline-start" />}
                  {t("common.delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function NameDialog({
  open,
  title,
  label,
  initial,
  submitLabel,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label: string;
  initial: string;
  submitLabel: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) onSubmit(value.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Input
            aria-label={label}
            placeholder={label}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => {
              // Seleziona il nome senza estensione, come nei file manager.
              const dot = e.target.value.lastIndexOf(".");
              e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
            }}
            autoFocus
            maxLength={255}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !value.trim()}>
              {busy && <Spinner data-icon="inline-start" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({
  open,
  state,
  folders,
  currentId,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  state: Targets | null;
  folders: Folder[];
  currentId: number | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (targets: Targets, target: number | null) => void;
}) {
  const [target, setTarget] = useState<number | null>(currentId);
  useEffect(() => {
    if (open) setTarget(currentId);
  }, [open, currentId]);
  // Una cartella non può finire dentro se stessa o in una sua sottocartella.
  const disabled = useMemo(
    () => new Set((state?.folders ?? []).flatMap((id) => [...descendantsOf(folders, id)])),
    [state, folders],
  );
  const count = (state?.folders.length ?? 0) + (state?.media.length ?? 0);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("media.moveTitle", { count })}</DialogTitle>
        </DialogHeader>
        <FolderPicker folders={folders} value={target} onChange={setTarget} disabled={disabled} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={busy || (target === currentId && !state?.folders.length) || (target !== null && disabled.has(target))}
            onClick={() => open && state && onSubmit(state, target)}
          >
            {busy && <Spinner data-icon="inline-start" />}
            {t("media.moveHere")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
