import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { ANALYTICS_ENDPOINT, CONSENT_CHANGE_EVENT } from "~/lib/analytics";
import { readConsent } from "./consent";
import { usePage, useSite } from "./site";

// Raccolta delle analytics interne. Non scrive cookie né storage: l'id della pagina vista vive solo
// in memoria e serve ad aggiornarla all'uscita (tempo attivo, scroll, Web Vitals).

type Props = Record<string, string | number | boolean>;

declare global {
  interface Window {
    /** API per i temi: `window.np.track("iscrizione", { piano: "pro" })`. */
    np?: { track: (name: string, props?: Props) => void };
  }
}

type View = { id: string; path: string; first: boolean; engaged: number; visibleSince: number | null; scroll: number };

const DOWNLOAD =
  /\.(pdf|zip|rar|7z|gz|dmg|exe|msi|apk|docx?|xlsx?|pptx?|odt|ods|csv|txt|rtf|epub|mp3|wav|mp4|mov|avi|webm)$/i;
const vitals: { ttfb?: number; fcp?: number; lcp?: number; cls?: number; inp?: number } = {};
let current: View | null = null;
let vitalsObserved = false;

function send(payload: Record<string, unknown>, beacon = false) {
  const body = JSON.stringify(payload);
  if (beacon && navigator.sendBeacon?.(ANALYTICS_ENDPOINT, new Blob([body], { type: "text/plain" }))) return;
  fetch(ANALYTICS_ENDPOINT, {
    method: "POST",
    body,
    keepalive: true,
    credentials: "same-origin",
    headers: { "Content-Type": "text/plain" },
  }).catch(() => {});
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

/** Core Web Vitals della pagina caricata: TTFB, FCP, LCP, CLS e una stima di INP. */
function observeVitals() {
  if (vitalsObserved || typeof PerformanceObserver === "undefined") return;
  vitalsObserved = true;
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (navigation && navigation.responseStart > 0) vitals.ttfb = Math.round(navigation.responseStart);
  const observe = (type: string, callback: (entry: PerformanceEntry & Record<string, any>) => void, options = {}) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(callback)).observe({
        type,
        buffered: true,
        ...options,
      });
    } catch {
      // tipo non supportato dal browser
    }
  };
  observe("paint", (entry) => {
    if (entry.name === "first-contentful-paint") vitals.fcp = Math.round(entry.startTime);
  });
  observe("largest-contentful-paint", (entry) => (vitals.lcp = Math.round(entry.startTime)));
  let cls = 0;
  observe("layout-shift", (entry) => {
    if (entry.hadRecentInput) return;
    cls += entry.value;
    vitals.cls = Math.round(cls * 1000);
  });
  observe(
    "event",
    (entry) => {
      if (entry.interactionId) vitals.inp = Math.max(vitals.inp ?? 0, Math.round(entry.duration));
    },
    { durationThreshold: 40 },
  );
}

function engagedMs(view: View) {
  return Math.round(view.engaged + (view.visibleSince === null ? 0 : performance.now() - view.visibleSince));
}

function sendLeave(view: View) {
  send({ t: "lv", v: view.id, e: engagedMs(view), d: view.scroll, w: view.first ? vitals : undefined }, true);
}

function track(name: string, props?: Props) {
  if (!current) return;
  send({ t: "ev", v: current.id, p: current.path, n: name.slice(0, 64), pr: props }, true);
}

function utmOf(search: string) {
  const params = new URLSearchParams(search);
  const utm: Record<string, string> = {};
  for (const key of ["source", "medium", "campaign", "term", "content"]) {
    const value = params.get(`utm_${key}`);
    if (value) utm[key] = value;
  }
  return Object.keys(utm).length ? utm : undefined;
}

function updateScroll() {
  if (!current) return;
  const height = document.documentElement.scrollHeight;
  const seen = window.scrollY + window.innerHeight;
  const depth = height > 0 ? Math.min(100, Math.round((seen / height) * 100)) : 100;
  if (depth > current.scroll) current.scroll = depth;
}

function onClick(event: MouseEvent) {
  const target = (event.target as Element | null)?.closest?.("[data-np-event], a[href]");
  if (!target) return;
  const custom = target.getAttribute("data-np-event");
  if (custom) {
    const props: Props = {};
    for (const attr of Array.from(target.attributes)) {
      if (attr.name.startsWith("data-np-prop-")) props[attr.name.slice(13)] = attr.value;
    }
    track(custom, props);
    return;
  }
  let url: URL;
  try {
    url = new URL((target as HTMLAnchorElement).href, location.href);
  } catch {
    return;
  }
  // Di email e telefoni si registra solo il tipo, mai l'indirizzo.
  if (url.protocol === "mailto:") track("contact", { type: "email" });
  else if (url.protocol === "tel:") track("contact", { type: "phone" });
  else if (!/^https?:$/.test(url.protocol)) return;
  else if (DOWNLOAD.test(url.pathname))
    track("download", { file: url.host === location.host ? url.pathname : url.origin + url.pathname });
  else if (url.host !== location.host) track("outbound", { url: url.origin + url.pathname });
}

function onSubmit(event: SubmitEvent) {
  const form = event.target as HTMLFormElement;
  track("form_submit", { form: form.id || form.getAttribute("name") || new URL(form.action, location.href).pathname });
}

function onVisibility() {
  if (!current) return;
  if (document.visibilityState === "hidden") {
    if (current.visibleSince !== null) current.engaged += performance.now() - current.visibleSince;
    current.visibleSince = null;
    sendLeave(current);
  } else if (current.visibleSince === null) {
    current.visibleSince = performance.now();
  }
}

/** Il visitatore ha chiesto di non essere tracciato (Do Not Track o Global Privacy Control). */
function optedOut() {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

/** Analytics interne: pagine viste, tempo attivo, scroll, Web Vitals ed eventi. */
export function Analytics() {
  const site = useSite();
  const page = usePage();
  const location = useLocation();
  const { enabled, consent } = site.analytics;
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!enabled || site.theme.preview || optedOut()) return;
    const update = () => setActive(!consent || readConsent() === "granted");
    update();
    window.addEventListener(CONSENT_CHANGE_EVENT, update);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, update);
  }, [enabled, consent, site.theme.preview]);

  useEffect(() => {
    if (!active) return;
    observeVitals();
    let frame = 0;
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), updateScroll()));
    };
    const onPageHide = () => current && sendLeave(current);
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.np = { track };
    return () => {
      if (current) sendLeave(current);
      current = null;
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("scroll", onScroll);
      delete window.np;
    };
  }, [active]);

  const nodeId = page?.node.id;
  useEffect(() => {
    if (!active) return;
    const previous = current;
    if (previous) sendLeave(previous);
    const view: View = {
      id: randomId(),
      path: location.pathname,
      first: !previous,
      engaged: 0,
      visibleSince: document.visibilityState === "visible" ? performance.now() : null,
      scroll: 0,
    };
    current = view;
    // Dopo il commit, quando il titolo della nuova pagina è già nel documento.
    let sent = false;
    const timer = window.setTimeout(() => {
      sent = true;
      updateScroll();
      const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
      send({
        t: "pv",
        v: view.id,
        p: view.path,
        ti: document.title,
        l: site.lang,
        n: nodeId,
        s: nodeId ? 200 : 404,
        r: previous ? undefined : document.referrer || undefined,
        pp: previous?.path,
        u: utmOf(location.search),
        sw: screen.width,
        sh: screen.height,
        dpr: Math.round(devicePixelRatio * 100) / 100,
        bl: navigator.language,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        cs: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
        c: connection?.effectiveType,
        tp: navigator.maxTouchPoints,
      });
    });
    return () => {
      window.clearTimeout(timer);
      // Effetto annullato prima dell'invio (es. doppio montaggio in sviluppo): la pagina precedente resta quella corrente.
      if (!sent) current = previous;
    };
    // Una pagina vista per percorso: i cambi di sola query string (es. ?page=2) non contano.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, location.pathname]);

  return null;
}
