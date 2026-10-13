import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, FolderIcon, UploadIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { t } from "~/admin/i18n";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import type { MediaRef } from "~/lib/media";
import { cn } from "~/lib/utils";
import { FolderTree } from "../components/media-library/folder-tree";
import { childrenOf, type Folder } from "../components/media-library/folders";
import { MediaThumb } from "../components/media-thumb";

type PickerData = {
  items: (MediaRef & { originalName: string })[];
  total: number;
  page: number;
  perPage: number;
  folderId: number | null;
  folders: Folder[];
};

/** Dialog per scegliere uno o più media dalla libreria (con caricamento). */
export function MediaPicker({
  open,
  onOpenChange,
  onSelect,
  multiple = false,
  type = "image",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (media: MediaRef[]) => void;
  multiple?: boolean;
  type?: string;
}) {
  const list = useFetcher<PickerData>();
  const upload = useFetcher<{ ids?: number[]; error?: string }>();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [selected, setSelected] = useState<MediaRef[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const params = new URLSearchParams({ page: String(page), q: query, type });
    if (folderId !== null) params.set("folder", String(folderId));
    list.load(`/admin/media/picker?${params}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, page, query, type, folderId, upload.data]);

  useEffect(() => {
    if (!open) setSelected([]);
  }, [open]);

  const toggle = (item: MediaRef) => {
    setSelected((current) => {
      const exists = current.some((m) => m.id === item.id);
      if (!multiple) return exists ? [] : [item];
      return exists ? current.filter((m) => m.id !== item.id) : [...current, item];
    });
  };

  const openFolder = (id: number | null) => {
    setFolderId(id);
    setPage(1);
  };

  const data = list.data;
  const folders = data?.folders ?? [];
  // Le sottocartelle compaiono in griglia solo nella prima pagina e senza ricerca, come nella libreria.
  const subfolders = page === 1 && !query ? childrenOf(folders, folderId) : [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("media.pickTitle")}</DialogTitle>
          <DialogDescription>{multiple ? t("media.pickMultiple") : t("media.pickOne")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder={t("common.search")}
            className="max-w-xs"
            onChange={(e) => {
              setPage(1);
              setQuery(e.target.value);
            }}
          />
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept={type === "image" ? "image/*" : undefined}
            onChange={(e) => {
              const files = e.target.files;
              if (!files?.length) return;
              const form = new FormData();
              for (const file of files) form.append("files", file);
              if (folderId !== null) form.set("folder", String(folderId));
              upload.submit(form, { method: "post", action: "/admin/media", encType: "multipart/form-data" });
              e.target.value = "";
            }}
          />
          <Button type="button" variant="outline" disabled={upload.state !== "idle"} onClick={() => fileRef.current?.click()}>
            {upload.state !== "idle" ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
            {t("media.upload")}
          </Button>
          {upload.data?.error && <span className="self-center text-sm text-destructive">{upload.data.error}</span>}
        </div>
        <div className="grid min-h-0 gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <div className="hidden max-h-[55vh] overflow-y-auto rounded-lg border p-1 sm:block">
            {data && <FolderTree folders={folders} currentId={folderId} onOpen={openFolder} />}
          </div>
          <div className="grid max-h-[55vh] content-start grid-cols-3 gap-3 overflow-y-auto p-1 sm:grid-cols-4 lg:grid-cols-5">
            {subfolders.map((folder) => (
              <button
                key={`folder:${folder.id}`}
                type="button"
                onClick={() => openFolder(folder.id)}
                className="flex flex-col gap-1 rounded-lg text-left outline-none ring-primary focus-visible:ring-2"
                title={folder.name}
              >
                <span className="flex aspect-square items-center justify-center rounded-lg bg-muted">
                  <FolderIcon className="size-1/2 fill-primary/15 text-primary/70" strokeWidth={1.25} />
                </span>
                <span className="truncate px-0.5 text-xs">{folder.name}</span>
              </button>
            ))}
            {data?.items.map((item) => {
              const isSelected = selected.some((m) => m.id === item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggle(item)}
                  className="group flex flex-col gap-1 rounded-lg text-left outline-none"
                  title={item.originalName}
                >
                  <span
                    className={cn(
                      "relative rounded-lg ring-primary group-focus-visible:ring-2",
                      isSelected && "ring-2",
                    )}
                  >
                    <MediaThumb media={item} />
                    {isSelected && (
                      <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <CheckIcon className="size-3" />
                      </span>
                    )}
                  </span>
                  <span className="truncate px-0.5 text-xs">{item.originalName}</span>
                </button>
              );
            })}
            {list.state === "loading" && !data && <Spinner />}
            {data && !data.items.length && !subfolders.length && (
              <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
                {query ? t("media.noResults") : t("media.emptyFolder")}
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeftIcon data-icon="inline-start" />
              {t("common.previous")}
            </Button>
            <span className="text-sm text-muted-foreground">{t("common.pageOf", { page, pages })}</span>
            <Button type="button" variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              {t("common.next")}
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          </div>
          <Button
            type="button"
            disabled={!selected.length}
            onClick={() => {
              onSelect(selected);
              onOpenChange(false);
            }}
          >
            <CheckIcon data-icon="inline-start" />
            {t("media.pickConfirm", { count: selected.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
