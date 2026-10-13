import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type * as Monaco from "monaco-editor";
import { Spinner } from "~/components/ui/spinner";
import { languageOf, loadMonaco, type MonacoApi } from "./monaco";

export type EditorError = { message: string; file: string | null; line: number | null; column: number | null };

export type CodeEditorHandle = {
  /** Contenuto attuale di un file aperto (null se non è caricato). */
  valueOf: (path: string) => string | null;
  /** Segna un file come salvato con il contenuto attuale. */
  markSaved: (path: string) => void;
  /** Chiude il modello di un file (eliminato, rinominato o scheda chiusa). */
  dispose: (path: string) => void;
  /** Porta il cursore a una posizione; se il file non è ancora caricato, appena lo è. */
  reveal: (path: string, line: number, column: number) => void;
};

type Props = {
  ref?: Ref<CodeEditorHandle>;
  /** File mostrato; null = nessun file aperto. */
  path: string | null;
  load: (path: string) => Promise<string>;
  error: EditorError | null;
  onChange: (path: string, content: string, dirty: boolean) => void;
  onSave: (path: string) => void;
};

type Entry = { model: Monaco.editor.ITextModel; savedVersion: number };

function isDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

/** Editor Monaco con un modello per file: undo, cursore e modifiche restano quando si cambia scheda. */
export function CodeEditor({ ref, path, load, error, onChange, onSave }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [monaco, setMonaco] = useState<MonacoApi | null>(null);
  const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const entries = useRef(new Map<string, Entry>());
  const views = useRef(new Map<string, Monaco.editor.ICodeEditorViewState | null>());
  const current = useRef<string | null>(null);
  const callbacks = useRef({ onChange, onSave, load });
  callbacks.current = { onChange, onSave, load };
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const pendingReveal = useRef<{ path: string; line: number; column: number } | null>(null);

  const applyReveal = () => {
    const target = pendingReveal.current;
    const instance = editor.current;
    if (!target || !instance || current.current !== target.path || !entries.current.has(target.path)) return;
    pendingReveal.current = null;
    instance.revealLineInCenter(target.line);
    instance.setPosition({ lineNumber: target.line, column: target.column });
    instance.focus();
  };

  // Crea l'editor una volta sola, nel browser.
  useEffect(() => {
    let disposed = false;
    const models = entries.current;
    void loadMonaco().then((api) => {
      if (disposed || !container.current) return;
      const instance = api.editor.create(container.current, {
        model: null,
        automaticLayout: true,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 2,
        theme: isDark() ? "vs-dark" : "vs",
        renderWhitespace: "selection",
        stickyScroll: { enabled: true },
        fixedOverflowWidgets: true,
      });
      instance.addCommand(api.KeyMod.CtrlCmd | api.KeyCode.KeyS, () => {
        if (current.current) callbacks.current.onSave(current.current);
      });
      editor.current = instance;
      setMonaco(api);
    });
    return () => {
      disposed = true;
      editor.current?.dispose();
      for (const entry of models.values()) entry.model.dispose();
      models.clear();
    };
  }, []);

  // Cambio file: carica il contenuto la prima volta, poi riusa il modello.
  useEffect(() => {
    if (!monaco || !editor.current) return;
    const instance = editor.current;
    if (current.current) views.current.set(current.current, instance.saveViewState());
    current.current = path;
    if (!path) {
      instance.setModel(null);
      return;
    }
    const existing = entries.current.get(path);
    if (existing) {
      instance.setModel(existing.model);
      instance.restoreViewState(views.current.get(path) ?? null);
      instance.focus();
      applyReveal();
      return;
    }
    let cancelled = false;
    setLoadingPath(path);
    void callbacks.current
      .load(path)
      .then((content) => {
        if (cancelled || entries.current.has(path)) return;
        const model = monaco.editor.createModel(content, languageOf(path), monaco.Uri.file(path));
        const entry = { model, savedVersion: model.getAlternativeVersionId() };
        entries.current.set(path, entry);
        model.onDidChangeContent(() => {
          callbacks.current.onChange(path, model.getValue(), model.getAlternativeVersionId() !== entry.savedVersion);
        });
        if (current.current === path) {
          instance.setModel(model);
          instance.focus();
          applyReveal();
        }
      })
      .finally(() => !cancelled && setLoadingPath(null));
    return () => {
      cancelled = true;
    };
  }, [monaco, path]);

  // Errore di compilazione del file mostrato: sottolineato nel codice.
  useEffect(() => {
    if (!monaco || !path) return;
    const entry = entries.current.get(path);
    if (!entry) return;
    const markers: Monaco.editor.IMarkerData[] =
      error && error.file === path
        ? [
            {
              severity: monaco.MarkerSeverity.Error,
              message: error.message,
              startLineNumber: error.line ?? 1,
              startColumn: error.column ?? 1,
              endLineNumber: error.line ?? 1,
              endColumn: (error.column ?? 1) + 1,
            },
          ]
        : [];
    // Un errore a colonna singola è poco visibile: lo estende fino alla fine della parola.
    if (markers[0]) {
      const word = entry.model.getWordAtPosition({
        lineNumber: markers[0].startLineNumber,
        column: markers[0].startColumn,
      });
      markers[0].endColumn = word ? word.endColumn : entry.model.getLineMaxColumn(markers[0].startLineNumber);
    }
    monaco.editor.setModelMarkers(entry.model, "nodepress", markers);
  }, [monaco, path, error, loadingPath]);

  useImperativeHandle(
    ref,
    () => ({
      valueOf: (file) => entries.current.get(file)?.model.getValue() ?? null,
      markSaved: (file) => {
        const entry = entries.current.get(file);
        if (!entry) return;
        entry.savedVersion = entry.model.getAlternativeVersionId();
        callbacks.current.onChange(file, entry.model.getValue(), false);
      },
      dispose: (file) => {
        const entry = entries.current.get(file);
        if (!entry) return;
        if (editor.current?.getModel() === entry.model) editor.current.setModel(null);
        entry.model.dispose();
        entries.current.delete(file);
        views.current.delete(file);
      },
      reveal: (file, line, column) => {
        pendingReveal.current = { path: file, line, column };
        applyReveal();
      },
    }),
    [],
  );

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={container} className="absolute inset-0" />
      {(!monaco || loadingPath) && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60">
          <Spinner />
        </div>
      )}
    </div>
  );
}
