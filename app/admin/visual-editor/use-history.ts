import { useCallback, useRef, useState } from "react";

const MAX_STEPS = 100;
/** Modifiche allo stesso campo più vicine di così diventano un solo passo (es. mentre si scrive). */
const COALESCE_MS = 800;

/** Stato con annulla/ripeti. `set(next, key)`: modifiche consecutive con la stessa chiave si uniscono. */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState({ past: [] as T[], present: initial, future: [] as T[] });
  const last = useRef<{ key: string | null; at: number }>({ key: null, at: 0 });

  const set = useCallback((next: T, key: string | null = null) => {
    const now = Date.now();
    const coalesce = key !== null && last.current.key === key && now - last.current.at < COALESCE_MS;
    last.current = { key, at: now };
    setState((s) => ({
      past: coalesce ? s.past : [...s.past, s.present].slice(-MAX_STEPS),
      present: next,
      future: [],
    }));
  }, []);

  const undo = useCallback(() => {
    last.current = { key: null, at: 0 };
    setState((s) =>
      s.past.length
        ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] }
        : s,
    );
  }, []);

  const redo = useCallback(() => {
    last.current = { key: null, at: 0 };
    setState((s) =>
      s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s,
    );
  }, []);

  return { value: state.present, set, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
