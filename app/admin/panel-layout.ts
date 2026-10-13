import { useRef } from "react";
import type { Layout } from "react-resizable-panels";

/**
 * Larghezze delle colonne ridimensionabili, per insieme di pannelli visibili.
 * Stanno in un cookie così il server le rende già giuste: con localStorage l'idratazione non combacerebbe.
 */
export type PanelLayouts = Record<string, Layout>;

const cookieName = (id: string) => `np_layout_${id}`;

/** Dal loader: le larghezze salvate per il gruppo `id`. */
export function readPanelLayouts(request: Request, id: string): PanelLayouts {
  const match = request.headers.get("Cookie")?.match(new RegExp(`(?:^|; )${cookieName(id)}=([^;]*)`));
  if (!match) return {};
  try {
    const value = JSON.parse(decodeURIComponent(match[1]));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/** Props per `ResizablePanelGroup`: layout iniziale e salvataggio dopo ogni trascinamento. */
export function usePanelLayout(id: string, initial: PanelLayouts, panels: string[]) {
  const layouts = useRef(initial);
  const key = panels.join(",");
  return {
    defaultLayout: layouts.current[key],
    onLayoutChanged: (layout: Layout) => {
      layouts.current = { ...layouts.current, [key]: layout };
      const value = encodeURIComponent(JSON.stringify(layouts.current));
      document.cookie = `${cookieName(id)}=${value}; path=/admin; max-age=31536000; SameSite=Lax`;
    },
  };
}
