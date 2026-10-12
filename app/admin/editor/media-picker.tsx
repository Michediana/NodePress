import { CheckIcon, UploadIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { t } from "~/admin/i18n";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import type { MediaRef } from "~/lib/media";
import { cn } from "~/lib/utils";
import { MediaThumb } from "../components/media-thumb";

type PickerData = { items: (MediaRef & { originalName: string })[]; total: number; page: number; perPage: number };

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
  const [selected, setSelected] = useState<MediaRef[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const params = new URLSearchParams({ page: String(page), q: query, type });
    list.load(`/admin/media/picker?${params}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, page, query, type, upload.data]);

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

  const data = list.data;
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
        <div className="grid max-h-[55vh] grid-cols-3 gap-3 overflow-y-auto p-1 sm:grid-cols-5 lg:grid-cols-6">
          {data?.items.map((item) => {
            const isSelected = selected.some((m) => m.id === item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => toggle(item)}
                className={cn("relative rounded-lg text-left outline-none ring-primary focus-visible:ring-2", isSelected && "ring-2")}
                title={item.originalName}
              >
                <MediaThumb media={item} />
                {isSelected && (
                  <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <CheckIcon className="size-3" />
                  </span>
                )}
              </button>
            );
          })}
          {list.state === "loading" && !data && <Spinner />}
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t("common.previous")}
            </Button>
            <span className="text-sm text-muted-foreground">{t("common.pageOf", { page, pages })}</span>
            <Button type="button" variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              {t("common.next")}
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
            {t("media.pickConfirm", { count: selected.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
