import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { cn } from "~/lib/utils";

export type Viewport = "mobile" | "tablet" | "desktop";

/** Larghezze simulate: sopra i breakpoint del tema (768 e 1024). */
export const VIEWPORT_WIDTHS: Record<Viewport, number> = { mobile: 390, tablet: 820, desktop: 1280 };

export type CanvasHandle = {
  /** Ricarica l'anteprima senza sfarfallio (iframe nascosto, poi scambio). */
  reload: () => void;
  /** Porta la sezione in vista. */
  reveal: (id: string) => void;
};

type Props = {
  ref?: Ref<CanvasHandle>;
  theme: string;
  path: string;
  viewport: Viewport;
  tokens: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  labelOf: (id: string) => string;
};

type Box = { top: number; left: number; width: number; height: number };

const previewUrl = (path: string, extra: string) => `${path}${path.includes("?") ? "&" : "?"}${extra}`;

/**
 * Anteprima del front nell'editor visuale. L'iframe non esegue script (sandbox senza
 * `allow-scripts`): selezione, evidenziazione e token live sono gestiti dal pannello, che
 * accede al documento dell'iframe perché ha la stessa origine.
 */
export function Canvas({ ref, theme, path, viewport, tokens, selectedId, onSelect, labelOf }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const frames = [useRef<HTMLIFrameElement>(null), useRef<HTMLIFrameElement>(null)];
  const [active, setActive] = useState(0);
  // L'URL si assegna dopo il montaggio: se l'iframe si caricasse durante l'SSR, il "load"
  // arriverebbe prima dell'hydration e l'anteprima non verrebbe collegata.
  const [srcs, setSrcs] = useState<[string, string]>(["about:blank", "about:blank"]);
  useEffect(() => {
    setSrcs([previewUrl(path, `np_preview=${encodeURIComponent(theme)}`), "about:blank"]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<{ hover: Box | null; selected: Box | null }>({ hover: null, selected: null });
  const pending = useRef<{ frame: number; keepScroll: boolean } | null>(null);
  const appliedTokens = useRef(new Set<string>());
  const state = useRef({ selectedId, hoverId, tokens, onSelect, active });
  state.current = { selectedId, hoverId, tokens, onSelect, active };

  const frameAt = (i: number) => frames[i].current;
  const docOf = (i: number) => {
    try {
      return frameAt(i)?.contentDocument ?? null;
    } catch {
      return null;
    }
  };

  // Dimensioni dello spazio disponibile: la viewport simulata viene scalata per starci.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const width = VIEWPORT_WIDTHS[viewport];
  const scale = size.width ? Math.min(1, (size.width - 32) / width) : 1;

  /** Riquadro di una sezione nel sistema di coordinate dell'iframe. */
  const boxOf = useCallback((id: string | null): Box | null => {
    const doc = docOf(state.current.active);
    if (!id || !doc) return null;
    const wrapper = doc.querySelector(`[data-np-id="${CSS.escape(id)}"]`);
    if (!wrapper) return null;
    // Il contenitore ha display: contents e nessun riquadro: si misura il suo contenuto.
    const range = doc.createRange();
    range.selectNodeContents(wrapper);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const measure = useCallback(() => {
    setBoxes({ hover: boxOf(state.current.hoverId), selected: boxOf(state.current.selectedId) });
  }, [boxOf]);

  useEffect(measure, [selectedId, hoverId, active, viewport, size, measure]);
  // Le immagini e i font cambiano il layout dopo il caricamento: si rimisura di tanto in tanto.
  useEffect(() => {
    const timer = window.setInterval(measure, 600);
    return () => window.clearInterval(timer);
  }, [measure]);

  /** Token modificati nell'editor: variabili inline sull'<html> dell'anteprima, senza ricaricare. */
  const applyTokens = useCallback((doc: Document) => {
    const root = doc.documentElement;
    for (const name of appliedTokens.current)
      if (!(name in state.current.tokens)) root.style.removeProperty(`--np-${name}`);
    appliedTokens.current = new Set(Object.keys(state.current.tokens));
    for (const [name, value] of Object.entries(state.current.tokens)) root.style.setProperty(`--np-${name}`, value);
  }, []);

  useEffect(() => {
    const doc = docOf(active);
    if (doc) applyTokens(doc);
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, active, applyTokens, measure]);

  /** Collega il documento caricato: selezione al clic, hover, niente navigazione. */
  const attach = (doc: Document) => {
    const idAt = (target: EventTarget | null) =>
      target instanceof doc.defaultView!.Element
        ? (target.closest("[data-np-id]")?.getAttribute("data-np-id") ?? null)
        : null;
    doc.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.current.onSelect(idAt(event.target));
      },
      true,
    );
    doc.addEventListener("submit", (event) => event.preventDefault(), true);
    doc.addEventListener("mousemove", (event) => {
      const id = idAt(event.target);
      if (id !== state.current.hoverId) setHoverId(id);
    });
    doc.addEventListener("mouseleave", () => setHoverId(null));
    doc.defaultView?.addEventListener("scroll", measure, { passive: true });
    // In modifica i link non navigano: il cursore lo fa capire.
    const style = doc.createElement("style");
    style.textContent = "a, button { cursor: default !important; } .np-preview-badge { display: none !important; }";
    doc.head.appendChild(style);
    applyTokens(doc);
  };

  const onLoad = (index: number) => {
    const doc = docOf(index);
    if (!doc || doc.URL === "about:blank") return;
    attach(doc);
    const job = pending.current;
    if (job?.frame === index) {
      // Nuova versione pronta: riprende lo scroll e prende il posto di quella visibile.
      if (job.keepScroll) {
        const previous = frameAt(1 - index)?.contentWindow;
        doc.defaultView?.scrollTo(0, previous?.scrollY ?? 0);
      }
      pending.current = null;
      setActive(index);
    }
    measure();
  };

  const load = async (target: string, keepScroll: boolean) => {
    // Rinnova il cookie dell'anteprima (scade dopo 30 minuti) prima di ricaricare.
    await fetch(`/?np_preview=${encodeURIComponent(theme)}`, { redirect: "manual", credentials: "same-origin" }).catch(
      () => {},
    );
    const index = 1 - state.current.active;
    pending.current = { frame: index, keepScroll };
    setSrcs((current) => {
      const next = [...current] as [string, string];
      // Il parametro in più forza il caricamento anche quando l'URL non cambia.
      next[index] = previewUrl(target, `_np=${Date.now()}`);
      return next;
    });
  };

  // Cambio di pagina da mostrare.
  const firstPath = useRef(path);
  useEffect(() => {
    if (path === firstPath.current) return;
    firstPath.current = path;
    load(path, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Uscendo dall'editor l'anteprima si chiude (vedi anche Preview dell'editor di codice).
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (!mounted.current)
          fetch("/?np_preview=off", { redirect: "manual", credentials: "same-origin" }).catch(() => {});
      }, 50);
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      reload: () => load(path, true),
      reveal: (id) => {
        const doc = docOf(state.current.active);
        const wrapper = doc?.querySelector(`[data-np-id="${CSS.escape(id)}"]`);
        const target = wrapper?.firstElementChild ?? null;
        target?.scrollIntoView({ block: "center", behavior: "smooth" });
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, theme],
  );

  const offsetLeft = Math.max(16, (size.width - width * scale) / 2);
  const toStage = (box: Box) => ({
    top: 16 + box.top * scale,
    left: offsetLeft + box.left * scale,
    width: box.width * scale,
    height: box.height * scale,
  });
  const frameHeight = Math.max(0, (size.height - 32) / scale);

  return (
    <div ref={stage} className="relative min-h-0 flex-1 overflow-hidden bg-muted/50">
      {[0, 1].map((i) => (
        <iframe
          key={i}
          ref={frames[i]}
          src={srcs[i]}
          title={i === active ? "Anteprima" : undefined}
          aria-hidden={i !== active}
          sandbox="allow-same-origin"
          onLoad={() => onLoad(i)}
          className={cn("absolute border-0 bg-white shadow-sm", i === active ? "visible" : "invisible")}
          style={{
            top: 16,
            left: offsetLeft,
            width,
            height: frameHeight,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        />
      ))}
      {/* Riquadri sopra l'iframe: non intercettano il mouse. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {boxes.hover && boxes.hover !== boxes.selected && hoverId !== selectedId && (
          <div className="absolute rounded-sm border border-dashed border-sky-500" style={toStage(boxes.hover)} />
        )}
        {boxes.selected && selectedId && (
          <div className="absolute rounded-sm border-2 border-sky-500" style={toStage(boxes.selected)}>
            <span
              className={cn(
                "absolute left-0 rounded-sm bg-sky-500 px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-white",
                // In cima all'anteprima l'etichetta andrebbe fuori: la si mette dentro il riquadro.
                toStage(boxes.selected).top < 40 ? "top-0" : "-top-6",
              )}
            >
              {labelOf(selectedId)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
