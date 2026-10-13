import { useEffect, useState } from "react";
import { CONSENT_CHANGE_EVENT } from "~/lib/analytics";
import { CONSENT_COOKIE } from "~/lib/consent";
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

export function readConsent(): "granted" | "denied" | null {
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

/** Il banner serve: c'è tracking di terze parti o le analytics interne chiedono il consenso. */
function useConsentNeeded() {
  const { tracking, analytics } = useSite();
  return hasThirdParty(tracking) || (analytics.enabled && analytics.consent);
}

function hasThirdParty({ ga4Id, gtmId, clarityId }: Tracking) {
  return Boolean(ga4Id || gtmId || clarityId);
}

/** Carica GTM, GA4 e Clarity: chiamata solo dopo il consenso. */
function loadTracking(tracking: Tracking) {
  if (!hasThirdParty(tracking)) return;
  const { ga4Id, gtmId, clarityId } = tracking;
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
  const enabled = useConsentNeeded();
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
    window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: value }));
    if (value === "granted") loadTracking(tracking);
    else if (loaded) window.location.reload(); // revoca: ricarica senza script
  };

  return (
    <div role="dialog" aria-live="polite" aria-label={consent.title} className="np-consent">
      <p className="np-consent__title">{consent.title}</p>
      <p className="np-consent__text">{consent.text}</p>
      <div className="np-consent__actions">
        <button type="button" className="np-consent__button" onClick={() => choose("denied")}>
          {consent.reject}
        </button>
        <button
          type="button"
          className="np-consent__button np-consent__button--primary"
          onClick={() => choose("granted")}
        >
          {consent.accept}
        </button>
      </div>
    </div>
  );
}

/** Link per riaprire le preferenze cookie (es. nel footer). */
export function ConsentPreferencesLink({ children, className }: { children: React.ReactNode; className?: string }) {
  if (!useConsentNeeded()) return null;
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))}>
      {children}
    </button>
  );
}
