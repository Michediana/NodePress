import { useCallback, useState } from "react";

export type MarqueeBox = { left: number; top: number; width: number; height: number };

/**
 * Selezione a riquadro trascinando il mouse sulle aree vuote del contenitore.
 * Gli elementi selezionabili devono avere l'attributo `data-entry` con la propria chiave.
 */
export function useMarquee({
  selection,
  onSelect,
}: {
  selection: Set<string>;
  onSelect: (keys: Set<string>) => void;
}) {
  const [box, setBox] = useState<MarqueeBox | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || e.pointerType === "touch") return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-entry], button, a, input, label, [role=checkbox]")) return;
      e.preventDefault();
      const container = e.currentTarget;
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      const base = additive ? new Set(selection) : new Set<string>();
      // Coordinate di documento, così lo scroll durante il trascinamento non sposta l'origine.
      const start = { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
      let last = { x: e.clientX, y: e.clientY };
      let moved = false;

      const update = () => {
        const x = last.x + window.scrollX;
        const y = last.y + window.scrollY;
        if (!moved && Math.hypot(x - start.x, y - start.y) < 5) return;
        moved = true;
        const left = Math.min(start.x, x) - window.scrollX;
        const top = Math.min(start.y, y) - window.scrollY;
        const right = Math.max(start.x, x) - window.scrollX;
        const bottom = Math.max(start.y, y) - window.scrollY;
        setBox({ left, top, width: right - left, height: bottom - top });
        const next = new Set(base);
        for (const el of container.querySelectorAll<HTMLElement>("[data-entry]")) {
          const r = el.getBoundingClientRect();
          if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) next.add(el.dataset.entry!);
        }
        onSelect(next);
      };
      const move = (ev: PointerEvent) => {
        last = { x: ev.clientX, y: ev.clientY };
        update();
      };
      const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("scroll", update, true);
        setBox(null);
        // Un clic sul vuoto senza trascinare azzera la selezione.
        if (!moved && !additive) onSelect(new Set());
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("scroll", update, true);
    },
    [selection, onSelect],
  );

  return { box, onPointerDown };
}
