import {
  ArrowLeftIcon,
  CircleAlertIcon,
  CodeIcon,
  HistoryIcon,
  MonitorIcon,
  MousePointerClickIcon,
  Redo2Icon,
  SmartphoneIcon,
  TabletIcon,
  Undo2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useBeforeUnload, useBlocker, useRevalidator } from "react-router";
import { toast } from "sonner";
import type { CollectionOption } from "~/admin/components/section-settings";
import { t } from "~/admin/i18n";
import { MiniCode } from "~/admin/theme-editor/mini-code";
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
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import type { ThemeToken } from "~/lib/theme/manifest";
import type { SectionSchema } from "~/lib/theme/sections";
import type { EditorError as ThemeBuildError } from "~/admin/theme-editor/code-editor";
import { Canvas, type CanvasHandle, type Viewport } from "./canvas";
import { Inspector } from "./inspector";
import {
  duplicateNode,
  fileOfNode,
  findNode,
  insertNode,
  moveNode,
  newId,
  normalizeTree,
  removeNode,
  serializeTree,
  updateNode,
  type EditorDoc,
} from "./model";
import { SectionTree } from "./section-tree";
import { TokensPanel } from "./tokens-panel";
import { useHistory } from "./use-history";

export type VisualEditorData = {
  theme: {
    name: string;
    label: string;
    active: boolean;
    unpublished: boolean;
    buildError: ThemeBuildError | null;
    publishedBuildId: number | null;
  };
  templates: { name: string; label: string; file: string; editable: boolean; groups: string[]; path: string | null }[];
  trees: Record<string, unknown>;
  tokens: Record<string, ThemeToken>;
  tokenValues: Record<string, string>;
  customCss: string;
  schemas: Record<string, SectionSchema>;
  languages: string[];
  collections: CollectionOption[];
  builds: { id: number; publishedAt: string }[];
};

const SAVE_DELAY = 700;

/** Contenuto di ogni file che l'editor scrive, per capire cosa è cambiato rispetto all'ultimo salvataggio. */
function filesOf(doc: EditorDoc) {
  const files: Record<string, string> = {};
  for (const [file, tree] of Object.entries(doc.trees)) files[file] = serializeTree(tree);
  files["config/tokens.json"] = JSON.stringify(doc.tokens, null, 2) + "\n";
  files["config/custom.css"] = doc.css;
  return files;
}

type Outcome = { ok: boolean; error?: ThemeBuildError | null; message?: string };

export function VisualEditor({ data }: { data: VisualEditorData }) {
  const { theme, schemas } = data;
  const api = `/admin/appearance/${theme.name}/api`;
  const revalidator = useRevalidator();
  const canvas = useRef<CanvasHandle>(null);

  const initial = useMemo<EditorDoc>(
    () => ({
      trees: Object.fromEntries(Object.entries(data.trees).map(([file, raw]) => [file, normalizeTree(file, raw)])),
      tokens: data.tokenValues,
      css: data.customCss,
    }),
    // Solo al primo caricamento: dopo, lo stato vive nell'editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const history = useHistory(initial);
  const doc = history.value;

  const editable = data.templates.filter((tpl) => tpl.editable);
  const [templateName, setTemplateName] = useState(
    () => (editable.find((tpl) => tpl.name === "home") ?? editable[0])?.name ?? null,
  );
  const template = data.templates.find((tpl) => tpl.name === templateName) ?? null;
  const [path, setPath] = useState(template?.path ?? "/");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [selected, setSelected] = useState<{ file: string; id: string } | null>(null);
  const [tab, setTab] = useState("sections");
  const [status, setStatus] = useState<"saved" | "pending" | "saving">("saved");
  const [buildError, setBuildError] = useState<ThemeBuildError | null>(theme.buildError);
  const [unpublished, setUnpublished] = useState(theme.unpublished);
  const [dialog, setDialog] = useState<"publish" | null>(null);

  // --- Salvataggio automatico: i file cambiati, uno alla volta, poi l'anteprima si ricarica. ---
  const saved = useRef(filesOf(initial));
  const saving = useRef<Promise<void> | null>(null);
  const latest = useRef(doc);
  latest.current = doc;

  const save = useCallback(async () => {
    const files = filesOf(latest.current);
    const changed = Object.keys(files).filter((file) => files[file] !== saved.current[file]);
    if (!changed.length) return setStatus("saved");
    setStatus("saving");
    let error: ThemeBuildError | null = null;
    try {
      for (const file of changed) {
        const res = await fetch(api, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent: "save", path: file, content: files[file] }),
        });
        const outcome = (await res.json().catch(() => ({ ok: false }))) as Outcome;
        if (!res.ok || !outcome.ok) throw new Error(outcome.message ?? t("errors.generic"));
        saved.current[file] = files[file];
        error = outcome.error ?? null;
      }
      setBuildError(error);
      setUnpublished(true);
      // I token si vedono già (variabili inline): si ricarica solo per struttura, impostazioni e CSS.
      if (!error && changed.some((file) => file !== "config/tokens.json")) canvas.current?.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
    // Se nel frattempo è cambiato altro, si salva di nuovo.
    const again = Object.entries(filesOf(latest.current)).some(([file, content]) => content !== saved.current[file]);
    setStatus(again ? "pending" : "saved");
  }, [api]);

  useEffect(() => {
    const files = filesOf(doc);
    if (!Object.keys(files).some((file) => files[file] !== saved.current[file])) return;
    setStatus("pending");
    const timer = window.setTimeout(() => {
      saving.current = (saving.current ?? Promise.resolve()).then(save);
    }, SAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [doc, save]);

  const dirty = status !== "saved";
  useBeforeUnload(
    useCallback(
      (event) => {
        if (dirty) event.preventDefault();
      },
      [dirty],
    ),
  );
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(t("visual.leaveWhileSaving"))) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  // --- Annulla / ripeti da tastiera (non dentro i campi di testo o Monaco). ---
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable], .monaco-editor")) return;
      event.preventDefault();
      if (event.shiftKey) history.redo();
      else history.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history]);

  // --- Modifiche ---
  const selectedNode = selected
    ? (findNode(doc.trees[selected.file]?.sections ?? [], selected.id)?.node ?? null)
    : null;

  const select = (file: string, id: string) => {
    setSelected({ file, id });
    setTab("sections");
    canvas.current?.reveal(id);
  };

  const selectFromCanvas = (id: string | null) => {
    if (!id) return setSelected(null);
    const file = fileOfNode(doc, id, template?.file);
    if (file) {
      setSelected({ file, id });
      setTab("sections");
    }
  };

  const labelOf = (id: string) => {
    const file = fileOfNode(doc, id, template?.file);
    const node = file ? findNode(doc.trees[file].sections, id)?.node : null;
    return node ? (schemas[node.type]?.label ?? node.type) : id;
  };

  const changeTemplate = (name: string) => {
    const next = data.templates.find((tpl) => tpl.name === name);
    if (!next) return;
    setTemplateName(name);
    setSelected(null);
    if (next.path) setPath(next.path);
  };

  const groups = template?.groups ?? [];

  return (
    <div className="-m-4 flex h-[calc(100svh-3rem)] min-h-0 flex-col md:-m-6">
      {/* Barra superiore */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/admin/appearance" />}>
          <ArrowLeftIcon data-icon="inline-start" />
          {t("appearance.editor.back")}
        </Button>
        <span className="truncate font-medium">{theme.label}</span>
        {buildError ? (
          <Badge variant="destructive">{t("appearance.buildError")}</Badge>
        ) : (
          unpublished && <Badge variant="secondary">{t("appearance.unpublished")}</Badge>
        )}

        <div className="ml-4 hidden items-center gap-2 lg:flex">
          <Select
            value={templateName ?? ""}
            onValueChange={(v) => changeTemplate(String(v))}
            items={editable.map((tpl) => ({ value: tpl.name, label: tpl.label }))}
          >
            <SelectTrigger size="sm" className="min-w-40" aria-label={t("visual.template")}>
              <SelectValue placeholder={t("visual.template")} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {editable.map((tpl) => (
                  <SelectItem key={tpl.name} value={tpl.name}>
                    {tpl.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <ToggleGroup value={[viewport]} onValueChange={(v) => v[0] && setViewport(v[0] as Viewport)} size="sm">
            <ToggleGroupItem value="mobile" aria-label={t("appearance.editor.mobile")}>
              <SmartphoneIcon />
            </ToggleGroupItem>
            <ToggleGroupItem value="tablet" aria-label={t("appearance.editor.tablet")}>
              <TabletIcon />
            </ToggleGroupItem>
            <ToggleGroupItem value="desktop" aria-label={t("appearance.editor.desktop")}>
              <MonitorIcon />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <span className="mr-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            {status === "saving" && <Spinner className="size-3" />}
            {status === "saved" ? t("visual.saved") : status === "saving" ? t("visual.saving") : t("visual.pending")}
          </span>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={history.undo}
                  disabled={!history.canUndo}
                  aria-label={t("editor.undo")}
                />
              }
            >
              <Undo2Icon />
            </TooltipTrigger>
            <TooltipContent>{t("editor.undo")} (⌘Z)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={history.redo}
                  disabled={!history.canRedo}
                  aria-label={t("editor.redo")}
                />
              }
            >
              <Redo2Icon />
            </TooltipTrigger>
            <TooltipContent>{t("editor.redo")} (⇧⌘Z)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  nativeButton={false}
                  render={<Link to={`/admin/appearance/${theme.name}`} />}
                  aria-label={t("visual.code")}
                />
              }
            >
              <CodeIcon />
            </TooltipTrigger>
            <TooltipContent>{t("visual.code")}</TooltipContent>
          </Tooltip>
          <Button size="sm" className="ml-1" onClick={() => setDialog("publish")} disabled={dirty}>
            {t("appearance.publish")}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_320px]">
        {/* Pannello sinistro: sezioni, stile, CSS */}
        <aside className="flex min-h-0 flex-col border-r">
          <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="flex min-h-0 flex-1 flex-col gap-0">
            <TabsList className="m-2 grid grid-cols-3">
              <TabsTrigger value="sections">{t("visual.tabSections")}</TabsTrigger>
              <TabsTrigger value="style">{t("visual.tabStyle")}</TabsTrigger>
              <TabsTrigger value="css">CSS</TabsTrigger>
            </TabsList>
            <TabsContent value="sections" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
              {template?.editable ? (
                <>
                  <SectionTree
                    file={template.file}
                    doc={doc}
                    schemas={schemas}
                    selectedId={selected?.id ?? null}
                    onSelect={select}
                    onInsert={(ref, index, type) => {
                      const id = newId(doc, type);
                      history.set(insertNode(doc, ref, index, { id, type, settings: {}, slots: {} }));
                      setSelected({ file: ref.file, id });
                    }}
                    onMove={(from, to, index) => history.set(moveNode(doc, from, to, index))}
                    onRemove={(file, id) => {
                      history.set(removeNode(doc, file, id));
                      if (selected?.id === id) setSelected(null);
                    }}
                    onDuplicate={(file, id) => {
                      const result = duplicateNode(doc, file, id);
                      history.set(result.doc);
                      if (result.id) setSelected({ file, id: result.id });
                    }}
                    onToggleHidden={(file, id) =>
                      history.set(updateNode(doc, file, id, (n) => void (n.hidden = !n.hidden)))
                    }
                  />
                  {groups.map((file) => (
                    <div key={file} className="mt-4 border-t pt-3">
                      <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                        {t("visual.group", { name: file.slice("groups/".length, -".json".length) })}
                      </p>
                      <SectionTree
                        file={file}
                        doc={doc}
                        schemas={schemas}
                        selectedId={selected?.id ?? null}
                        onSelect={select}
                        onInsert={(ref, index, type) => {
                          const id = newId(doc, type);
                          history.set(insertNode(doc, ref, index, { id, type, settings: {}, slots: {} }));
                          setSelected({ file: ref.file, id });
                        }}
                        onMove={(from, to, index) => history.set(moveNode(doc, from, to, index))}
                        onRemove={(f, id) => history.set(removeNode(doc, f, id))}
                        onDuplicate={(f, id) => history.set(duplicateNode(doc, f, id).doc)}
                        onToggleHidden={(f, id) =>
                          history.set(updateNode(doc, f, id, (n) => void (n.hidden = !n.hidden)))
                        }
                      />
                    </div>
                  ))}
                </>
              ) : (
                <p className="p-2 text-sm text-muted-foreground">{t("visual.notEditable")}</p>
              )}
            </TabsContent>
            <TabsContent value="style" className="min-h-0 flex-1 overflow-y-auto">
              <TokensPanel
                tokens={data.tokens}
                values={doc.tokens}
                onChange={(name, value) => {
                  const tokens = { ...doc.tokens };
                  if (value === undefined) delete tokens[name];
                  else tokens[name] = value;
                  history.set({ ...doc, tokens }, `token:${name}`);
                }}
              />
            </TabsContent>
            <TabsContent value="css" className="flex min-h-0 flex-1 flex-col gap-2 p-3">
              <p className="text-xs text-muted-foreground">{t("visual.globalCssHelp")}</p>
              <MiniCode
                value={doc.css}
                onChange={(css) => history.set({ ...doc, css }, "css")}
                height={420}
                ariaLabel={t("visual.globalCss")}
              />
            </TabsContent>
          </Tabs>
        </aside>

        {/* Anteprima */}
        <section className="flex min-h-0 min-w-0 flex-col">
          {buildError && (
            <div className="flex shrink-0 items-start gap-2 border-b bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {buildError.file && <span className="font-medium">{buildError.file} — </span>}
                {buildError.message}
              </span>
            </div>
          )}
          <Canvas
            ref={canvas}
            theme={theme.name}
            path={path}
            viewport={viewport}
            tokens={doc.tokens}
            selectedId={selected?.id ?? null}
            onSelect={selectFromCanvas}
            labelOf={labelOf}
          />
        </section>

        {/* Inspector */}
        <aside className="min-h-0 overflow-y-auto border-l">
          {selected && selectedNode ? (
            <Inspector
              key={selected.id}
              node={selectedNode}
              schema={schemas[selectedNode.type]}
              viewport={viewport}
              languages={data.languages}
              collections={data.collections}
              onChange={(fn, key) => history.set(updateNode(doc, selected.file, selected.id, fn), key)}
              onDuplicate={() => {
                const result = duplicateNode(doc, selected.file, selected.id);
                history.set(result.doc);
                if (result.id) setSelected({ file: selected.file, id: result.id });
              }}
              onRemove={() => {
                history.set(removeNode(doc, selected.file, selected.id));
                setSelected(null);
              }}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <MousePointerClickIcon className="size-5" />
              {t("visual.selectHint")}
            </div>
          )}
        </aside>
      </div>

      <AlertDialog open={dialog === "publish"} onOpenChange={(open) => !open && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("appearance.publishDraft")}</AlertDialogTitle>
            <AlertDialogDescription>
              {theme.active ? t("appearance.editor.publishConfirm") : t("appearance.editor.publishInactive")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {data.builds.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <HistoryIcon className="size-3.5" />
                {t("visual.history")}
              </p>
              <ul className="flex max-h-48 flex-col overflow-y-auto rounded-md border text-sm">
                {data.builds.map((build) => (
                  <li
                    key={build.id}
                    className="flex items-center justify-between gap-2 border-b px-3 py-1.5 last:border-0"
                  >
                    <span>
                      {new Date(build.publishedAt).toLocaleString("it", { dateStyle: "medium", timeStyle: "short" })}
                      {build.id === theme.publishedBuildId && (
                        <Badge variant="secondary" className="ml-2">
                          {t("visual.online")}
                        </Badge>
                      )}
                    </span>
                    {build.id !== theme.publishedBuildId && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={async () => {
                          await publish(build.id);
                          setDialog(null);
                        }}
                      >
                        {t("visual.restore")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={!unpublished || Boolean(buildError)} onClick={() => publish()}>
              {t("appearance.publish")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  async function publish(buildId?: number) {
    const res = await fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "publish", ...(buildId ? { buildId } : {}) }),
    });
    const outcome = (await res.json().catch(() => ({ ok: false }))) as Outcome;
    if (!res.ok || !outcome.ok) return toast.error(outcome.message ?? t("errors.generic"));
    toast.success(buildId ? t("visual.restored") : t("appearance.publishedOk"));
    if (!buildId) setUnpublished(false);
    revalidator.revalidate();
  }
}
