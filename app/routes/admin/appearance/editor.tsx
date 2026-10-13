import {
  ArrowLeftIcon,
  PaintbrushIcon,
  CircleAlertIcon,
  FilePlusIcon,
  SaveIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useBeforeUnload, useBlocker, useRevalidator } from "react-router";
import { toast } from "sonner";
import { requirePermission } from "~/.server/auth";
import { env } from "~/.server/env";
import { previewUrl } from "~/.server/origins";
import { getSetting } from "~/.server/settings";
import { getBuild, listFiles, requireTheme } from "~/.server/theme/store";
import { t } from "~/admin/i18n";
import { CodeEditor, type CodeEditorHandle, type EditorError } from "~/admin/theme-editor/code-editor";
import { FileTree } from "~/admin/theme-editor/file-tree";
import { setThemeContext } from "~/admin/theme-editor/monaco";
import { Preview, type PreviewHandle } from "~/admin/theme-editor/preview";
import { TextField } from "~/admin/components/fields";
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
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { FieldGroup } from "~/components/ui/field";
import { Spinner } from "~/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { formatBytes } from "~/lib/media";
import { isImageFile, isTextFile } from "~/lib/theme/files";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/editor";

export async function loader({ params, context }: Route.LoaderArgs) {
  requirePermission(context, "themes.code");
  const theme = await requireTheme(params.name);
  const [files, active, draft] = await Promise.all([
    listFiles(theme.id),
    getSetting("activeTheme"),
    theme.draftBuildId ? getBuild(theme.draftBuildId) : null,
  ]);
  return {
    theme: {
      name: theme.name,
      label: theme.label,
      active: active === theme.name,
      buildError: theme.buildError,
      unpublished: theme.draftBuildId !== null && theme.draftBuildId !== theme.publishedBuildId,
    },
    files: files.map((f) => ({ path: f.path, size: Number(f.size) })),
    tokens: Object.keys(draft?.data.manifest.tokens ?? {}),
    // Dalla bozza: l'autocompletamento dei JSON segue le sezioni appena salvate.
    schemas: draft?.data.schemas ?? {},
    // Con l'origine separata l'anteprima con JS gira sul sito pubblico, lontano dalla sessione del pannello.
    publicPreview: env.adminUrl ? await previewUrl(theme.name) : null,
  };
}

type Outcome = { ok: boolean; buildId?: number | null; error?: EditorError | null; message?: string };

/** Contenuto iniziale di un file nuovo, in base a dove si trova. */
function starter(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1, path.lastIndexOf("."));
  if (path.startsWith("components/") && path.endsWith(".np"))
    return `<div class="${name.toLowerCase()}">\n  {children}\n</div>\n`;
  if (path.startsWith("templates/") && path.endsWith(".np"))
    return `<Layout>\n  <h1>{page.translation.title}</h1>\n  <Content />\n</Layout>\n`;
  if (path.endsWith(".np")) return "<div></div>\n";
  if (path.endsWith(".js") || path.endsWith(".ts"))
    return "// Gira solo nel browser: per l'interattività usa i custom element.\n";
  return "";
}

export default function ThemeEditor({ loaderData }: Route.ComponentProps) {
  const { theme, files, tokens, schemas } = loaderData;
  const api = `/admin/appearance/${theme.name}/api`;
  const revalidator = useRevalidator();
  const editor = useRef<CodeEditorHandle>(null);
  const preview = useRef<PreviewHandle>(null);
  const firstFile =
    files.find((f) => f.path === "templates/home.np")?.path ??
    files.find((f) => f.path.endsWith(".np"))?.path ??
    "theme.json";
  const [tabs, setTabs] = useState<string[]>([firstFile]);
  const [active, setActive] = useState<string | null>(firstFile);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [lint, setLint] = useState<Record<string, EditorError | null>>({});
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<
    { type: "new" } | { type: "rename"; path: string } | { type: "delete"; path: string } | { type: "publish" } | null
  >(null);
  const upload = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string | null>(null);
  const lintTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    const components = files.filter((f) => /^components\/[^/]+\.np$/.test(f.path)).map((f) => f.path.slice(11, -3));
    setThemeContext({ components, tokens, schemas });
  }, [files, tokens, schemas]);

  const anyDirty = Object.values(dirty).some(Boolean);
  useBeforeUnload(
    useCallback(
      (event) => {
        if (anyDirty) event.preventDefault();
      },
      [anyDirty],
    ),
  );
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => anyDirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(t("appearance.editor.unsavedLeave"))) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  const post = async (body: unknown): Promise<Outcome> => {
    const res = await fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({ ok: false }))) as Outcome;
    if (!res.ok || !json.ok) throw new Error(json.message ?? t("errors.generic"));
    return json;
  };

  const load = useCallback(
    async (path: string) => {
      const res = await fetch(`${api}?path=${encodeURIComponent(path)}`);
      return res.ok ? res.text() : "";
    },
    [api],
  );

  /** Dopo un salvataggio: aggiorna stato e anteprima, oppure segnala l'errore di compilazione. */
  const afterBuild = (outcome: Outcome, quiet = false) => {
    if (outcome.error) toast.error(t("appearance.editor.savedWithError"), { description: outcome.error.message });
    else {
      if (!quiet) toast.success(t("appearance.editor.savedBuilt"));
      preview.current?.reload();
    }
    revalidator.revalidate();
  };

  const open = (path: string) => {
    setTabs((list) => (list.includes(path) ? list : [...list, path]));
    setActive(path);
  };

  const closeTab = (path: string) => {
    if (dirty[path] && !window.confirm(t("appearance.editor.unsavedLeave"))) return;
    editor.current?.dispose(path);
    setDirty((d) => ({ ...d, [path]: false }));
    setTabs((list) => {
      const next = list.filter((p) => p !== path);
      if (active === path) setActive(next[Math.max(0, list.indexOf(path) - 1)] ?? null);
      return next;
    });
  };

  const save = async (path = active) => {
    if (!path || !isTextFile(path)) return;
    const content = editor.current?.valueOf(path);
    if (content === null || content === undefined) return;
    setSaving(true);
    try {
      const outcome = await post({ intent: "save", path, content });
      editor.current?.markSaved(path);
      setLint((l) => ({ ...l, [path]: outcome.error?.file === path ? outcome.error : null }));
      afterBuild(outcome, true);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  const onChange = useCallback(
    (path: string, content: string, isDirty: boolean) => {
      setDirty((d) => (d[path] === isDirty ? d : { ...d, [path]: isDirty }));
      window.clearTimeout(lintTimers.current[path]);
      lintTimers.current[path] = window.setTimeout(async () => {
        const result = await post({ intent: "lint", path, content }).catch(() => null);
        if (result) setLint((l) => ({ ...l, [path]: result.error ?? null }));
      }, 400);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api],
  );

  const onUpload = async (file: File) => {
    const target = uploadTarget.current ?? `assets/${file.name.replace(/[^\w.-]+/g, "-")}`;
    const form = new FormData();
    form.set("path", target);
    form.set("file", file);
    const res = await fetch(api, { method: "POST", body: form });
    const outcome = (await res.json().catch(() => ({ ok: false }))) as Outcome & { path?: string };
    if (!res.ok || !outcome.ok) return toast.error(outcome.message ?? t("errors.generic"));
    afterBuild(outcome);
    open(target);
  };

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
      setDialog(null);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const createFile = (path: string) =>
    run(async () => {
      const outcome = await post({ intent: "save", path, content: starter(path) });
      afterBuild(outcome, true);
      open(path);
    });

  const renameFile = (from: string, to: string) =>
    run(async () => {
      if (dirty[from]) await save(from);
      const outcome = await post({ intent: "rename", from, to });
      editor.current?.dispose(from);
      setTabs((list) => list.map((p) => (p === from ? to : p)));
      if (active === from) setActive(to);
      afterBuild(outcome, true);
    });

  const deleteFile = (path: string) =>
    run(async () => {
      const outcome = await post({ intent: "delete", path });
      editor.current?.dispose(path);
      setDirty((d) => ({ ...d, [path]: false }));
      setTabs((list) => list.filter((p) => p !== path));
      if (active === path) setActive(null);
      afterBuild(outcome, true);
    });

  const publish = () =>
    run(async () => {
      await post({ intent: "publish" });
      toast.success(t("appearance.publishedOk"));
      revalidator.revalidate();
    });

  const buildError = theme.buildError;
  const shownError = (active && lint[active]) || (buildError && buildError.file === active ? buildError : null);
  const activeFile = files.find((f) => f.path === active);

  return (
    <div className="-m-4 flex h-[calc(100svh-3rem)] min-h-0 flex-col md:-m-6">
      {/* Barra superiore */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/admin/appearance" />}>
          <ArrowLeftIcon data-icon="inline-start" />
          {t("appearance.editor.back")}
        </Button>
        <span className="truncate font-medium">{theme.label}</span>
        {theme.active && <Badge>{t("appearance.active")}</Badge>}
        {buildError ? (
          <Badge variant="destructive">{t("appearance.buildError")}</Badge>
        ) : (
          theme.unpublished && <Badge variant="secondary">{t("appearance.unpublished")}</Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground lg:inline">{t("appearance.editor.shortcuts")}</span>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link to={`/admin/appearance/${theme.name}/customize`} />}
          >
            <PaintbrushIcon data-icon="inline-start" />
            {t("visual.open")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => save()} disabled={!active || !dirty[active] || saving}>
            {saving ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
            {saving ? t("appearance.editor.saving") : t("appearance.editor.save")}
          </Button>
          <Button
            size="sm"
            onClick={() => setDialog({ type: "publish" })}
            disabled={!theme.unpublished || Boolean(buildError)}
          >
            {t("appearance.publish")}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_minmax(380px,40%)]">
        {/* File */}
        <aside className="flex min-h-0 flex-col border-r">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t("appearance.editor.files")}
            </span>
            <div className="flex">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setDialog({ type: "new" })}
                      aria-label={t("appearance.editor.newFile")}
                    />
                  }
                >
                  <FilePlusIcon />
                </TooltipTrigger>
                <TooltipContent>{t("appearance.editor.newFile")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => {
                        uploadTarget.current = null;
                        upload.current?.click();
                      }}
                      aria-label={t("appearance.editor.upload")}
                    />
                  }
                >
                  <UploadIcon />
                </TooltipTrigger>
                <TooltipContent>{t("appearance.editor.upload")}</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1">
            <FileTree
              files={files}
              active={active}
              dirty={dirty}
              errorFile={buildError?.file ?? null}
              onOpen={open}
              onRename={(path) => setDialog({ type: "rename", path })}
              onDelete={(path) => setDialog({ type: "delete", path })}
            />
          </div>
          <input
            ref={upload}
            type="file"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onUpload(file);
            }}
          />
        </aside>

        {/* Codice */}
        <section className="flex min-h-0 min-w-0 flex-col">
          <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b bg-muted/30">
            {tabs.map((path) => (
              <div
                key={path}
                className={cn(
                  "group flex shrink-0 items-center gap-1 border-r pr-1 pl-3 text-xs",
                  path === active ? "bg-background text-foreground" : "text-muted-foreground hover:bg-background/60",
                )}
              >
                <button
                  type="button"
                  onClick={() => setActive(path)}
                  className="flex items-center gap-1.5"
                  title={path}
                >
                  <span className={cn(lint[path] && "text-destructive")}>{path.slice(path.lastIndexOf("/") + 1)}</span>
                  {dirty[path] && (
                    <span className="size-1.5 rounded-full bg-foreground" aria-label={t("appearance.editor.unsaved")} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => closeTab(path)}
                  className="flex size-5 items-center justify-center rounded-sm opacity-60 hover:bg-muted hover:opacity-100"
                  aria-label={t("common.remove")}
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col">
            {/* L'editor resta montato: i file aperti conservano modifiche e cronologia. */}
            <CodeEditor
              ref={editor}
              path={active && isTextFile(active) ? active : null}
              load={load}
              error={shownError}
              onChange={onChange}
              onSave={(path) => saveRef.current(path)}
            />
            {!active && (
              <div className="absolute inset-0 flex items-center justify-center bg-background text-sm text-muted-foreground">
                {t("appearance.editor.noFile")}
              </div>
            )}
            {active && !isTextFile(active) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background p-6 text-sm text-muted-foreground">
                {isImageFile(active) && (
                  <img
                    src={`${api}?path=${encodeURIComponent(active)}`}
                    alt=""
                    className="max-h-64 max-w-full rounded-md border bg-[repeating-conic-gradient(#0001_0_25%,transparent_0_50%)] bg-[length:16px_16px]"
                  />
                )}
                <p>{t("appearance.editor.binary", { size: formatBytes(activeFile?.size ?? 0) })}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    uploadTarget.current = active;
                    upload.current?.click();
                  }}
                >
                  <UploadIcon data-icon="inline-start" />
                  {t("appearance.editor.replace")}
                </Button>
              </div>
            )}
          </div>

          {(shownError || buildError) && (
            <button
              type="button"
              className="flex shrink-0 items-start gap-2 border-t bg-destructive/5 px-3 py-2 text-left text-xs text-destructive"
              onClick={() => {
                const target = shownError ?? buildError;
                if (!target?.file) return;
                open(target.file);
                editor.current?.reveal(target.file, target.line ?? 1, target.column ?? 1);
              }}
            >
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {(shownError ?? buildError)?.file && (
                  <span className="font-medium">
                    {t("appearance.editor.errorAt", {
                      file: (shownError ?? buildError)!.file!,
                      line: (shownError ?? buildError)!.line ?? 1,
                    })}
                    {" — "}
                  </span>
                )}
                {(shownError ?? buildError)!.message}
              </span>
            </button>
          )}
        </section>

        {/* Anteprima */}
        <aside className="hidden min-h-0 flex-col border-l xl:flex">
          <Preview ref={preview} theme={theme.name} publicPreview={loaderData.publicPreview} />
        </aside>
      </div>

      <FileDialog
        open={dialog?.type === "new"}
        title={t("appearance.editor.newFile")}
        label={t("appearance.editor.newFilePath")}
        description={t("appearance.editor.newFilePathHelp")}
        initial="components/"
        onClose={() => setDialog(null)}
        onSubmit={createFile}
      />
      <FileDialog
        open={dialog?.type === "rename"}
        title={t("appearance.editor.rename")}
        label={t("appearance.editor.renamePath")}
        initial={dialog?.type === "rename" ? dialog.path : ""}
        onClose={() => setDialog(null)}
        onSubmit={(to) => dialog?.type === "rename" && renameFile(dialog.path, to)}
      />
      <AlertDialog
        open={dialog?.type === "delete" || dialog?.type === "publish"}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog?.type === "delete"
                ? t("appearance.editor.deleteFileTitle", { path: dialog.path })
                : t("appearance.publishDraft")}
            </AlertDialogTitle>
            {dialog?.type === "publish" && (
              <AlertDialogDescription>
                {theme.active ? t("appearance.editor.publishConfirm") : t("appearance.editor.publishInactive")}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            {dialog?.type === "delete" ? (
              <AlertDialogAction variant="destructive" onClick={() => deleteFile(dialog.path)}>
                {t("common.delete")}
              </AlertDialogAction>
            ) : (
              <AlertDialogAction onClick={publish}>{t("appearance.publish")}</AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FileDialog({
  open,
  title,
  label,
  description,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label: string;
  description?: string;
  initial: string;
  onClose: () => void;
  onSubmit: (path: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            const value = String(new FormData(e.currentTarget).get("path") ?? "").trim();
            if (value) onSubmit(value);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <TextField
              key={initial}
              name="path"
              label={label}
              description={description}
              defaultValue={initial}
              className="font-mono"
              autoFocus
              required
            />
          </FieldGroup>
          <DialogFooter>
            <Button type="submit">{title}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
