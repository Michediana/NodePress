import { useEffect, useState } from "react";
import { CONSENT_COOKIE } from "~/lib/consent";
import { Button } from "~/components/ui/button";
import { useSite } from "./site";

type Tracking = { ga4Id: string; gtmId: string; clarityId: string };

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
    clarity?: ((...args: unknown[]) => void) & { q?: unknown[] };
  }
}

/** Script inline da eseguire subito: Consent Mode v2 con tutto negato di default. */
export function consentDefaultsScript() {
  return [
    "window.dataLayer=window.dataLayer||[];",
    "window.gtag=window.gtag||function(){dataLayer.push(arguments);};",
    "gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500});",
  ].join("");
}

function readConsent(): "granted" | "denied" | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]*)`));
  return match?.[1] === "granted" ? "granted" : match?.[1] === "denied" ? "denied" : null;
}

function writeConsent(value: "granted" | "denied") {
  const maxAge = 60 * 60 * 24 * 180;
  document.cookie = `${CONSENT_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
}

function addScript(src: string) {
  if (document.querySelector(`script[src="${src}"]`)) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}

let loaded = false;

/** Carica GTM, GA4 e Clarity: chiamata solo dopo il consenso. */
function loadTracking({ ga4Id, gtmId, clarityId }: Tracking) {
  window.gtag("consent", "update", {
    ad_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "granted",
    analytics_storage: "granted",
  });
  if (loaded) return;
  loaded = true;
  if (gtmId) {
    window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    addScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`);
  }
  if (ga4Id) {
    addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`);
    window.gtag("js", new Date());
    window.gtag("config", ga4Id);
  }
  if (clarityId) {
    const clarity = function (...args: unknown[]) {
      (clarity.q = clarity.q || []).push(args);
    } as NonNullable<Window["clarity"]>;
    window.clarity = window.clarity || clarity;
    addScript(`https://www.clarity.ms/tag/${encodeURIComponent(clarityId)}`);
    window.clarity("consent");
  }
}

export const OPEN_CONSENT_EVENT = "np:open-consent";

/** Cookie banner nativo: gli script di tracking partono solo dopo "Accetta". */
export function ConsentBanner() {
  const { tracking, consent } = useSite();
  const enabled = Boolean(tracking.ga4Id || tracking.gtmId || tracking.clarityId);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const current = readConsent();
    if (current === "granted") loadTracking(tracking);
    else if (current === null) setOpen(true);
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
  }, [enabled, tracking]);

  if (!enabled || !open) return null;

  const choose = (value: "granted" | "denied") => {
    writeConsent(value);
    setOpen(false);
    if (value === "granted") loadTracking(tracking);
    else if (loaded) window.location.reload(); // revoca: ricarica senza script
  };

  return (
    <div role="dialog" aria-live="polite" aria-label={consent.title} className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl rounded-xl border bg-background p-5 shadow-lg">
      <p className="font-semibold">{consent.title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{consent.text}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={() => choose("denied")}>
          {consent.reject}
        </Button>
        <Button onClick={() => choose("granted")}>{consent.accept}</Button>
      </div>
    </div>
  );
}

/** Link per riaprire le preferenze cookie (es. nel footer). */
export function ConsentPreferencesLink({ children, className }: { children: React.ReactNode; className?: string }) {
  const { tracking } = useSite();
  if (!tracking.ga4Id && !tracking.gtmId && !tracking.clarityId) return null;
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))}>
      {children}
    </button>
  );
}
