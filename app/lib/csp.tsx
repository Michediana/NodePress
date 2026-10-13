import { createContext, useContext } from "react";

/** attiva: blocca ciò che viola la policy; report-only: segnala solo in console; off: nessuna CSP. */
export type CspMode = "enforce" | "report-only" | "off";

export const CSP_MODES: CspMode[] = ["enforce", "report-only", "off"];

/** Nonce della richiesta per gli script del front: lo fornisce entry.server durante l'SSR. */
export const NonceContext = createContext<string | undefined>(undefined);

/**
 * Nel browser l'attributo nonce viene svuotato, ma la proprietà `.nonce` conserva il valore ed è quella
 * che React confronta in hydration: il client la legge da uno script della pagina.
 */
const clientNonce =
  typeof document === "undefined"
    ? undefined
    : document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce || undefined;

/** Da passare a `<Links>`, `<Scripts>`, `<ScrollRestoration>` e a ogni `<script>` del front. */
export const useNonce = () => useContext(NonceContext) ?? clientNonce;
