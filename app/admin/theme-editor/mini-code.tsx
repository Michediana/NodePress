import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import { loadMonaco } from "./monaco";

/** Editor Monaco compatto per un singolo valore (es. CSS di override). */
export function MiniCode({
  value,
  onChange,
  language = "css",
  height = 200,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  height?: number;
  ariaLabel?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let disposed = false;
    void loadMonaco().then((monaco) => {
      if (disposed || !container.current) return;
      const instance = monaco.editor.create(container.current, {
        value,
        language,
        automaticLayout: true,
        fontSize: 12,
        minimap: { enabled: false },
        lineNumbers: "off",
        folding: false,
        scrollBeyondLastLine: false,
        tabSize: 2,
        ariaLabel,
        theme: document.documentElement.classList.contains("dark") ? "vs-dark" : "vs",
        fixedOverflowWidgets: true,
      });
      instance.onDidChangeModelContent(() => onChangeRef.current(instance.getValue()));
      editor.current = instance;
    });
    return () => {
      disposed = true;
      editor.current?.getModel()?.dispose();
      editor.current?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Valore cambiato da fuori (annulla, altra sezione): aggiorna senza perdere il cursore se uguale.
  useEffect(() => {
    const instance = editor.current;
    if (instance && instance.getValue() !== value) instance.setValue(value);
  }, [value]);

  return <div ref={container} className="overflow-hidden rounded-md border" style={{ height }} />;
}
