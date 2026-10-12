export type ConsentTexts = { title: string; text: string; accept: string; reject: string };

const builtin: Record<string, ConsentTexts> = {
  it: {
    title: "Rispettiamo la tua privacy",
    text: "Usiamo cookie di analisi per capire come viene usato il sito. Puoi accettarli o rifiutarli.",
    accept: "Accetta",
    reject: "Rifiuta",
  },
  en: {
    title: "We respect your privacy",
    text: "We use analytics cookies to understand how the site is used. You can accept or reject them.",
    accept: "Accept",
    reject: "Reject",
  },
  de: {
    title: "Wir respektieren Ihre Privatsphäre",
    text: "Wir verwenden Analyse-Cookies, um zu verstehen, wie die Website genutzt wird. Sie können sie akzeptieren oder ablehnen.",
    accept: "Akzeptieren",
    reject: "Ablehnen",
  },
  fr: {
    title: "Nous respectons votre vie privée",
    text: "Nous utilisons des cookies d'analyse pour comprendre comment le site est utilisé. Vous pouvez les accepter ou les refuser.",
    accept: "Accepter",
    reject: "Refuser",
  },
  es: {
    title: "Respetamos tu privacidad",
    text: "Usamos cookies de análisis para entender cómo se usa el sitio. Puedes aceptarlas o rechazarlas.",
    accept: "Aceptar",
    reject: "Rechazar",
  },
};

/** Testi del banner per una lingua: personalizzati, poi predefiniti, poi inglese. */
export function consentTextsFor(lang: string, custom: Record<string, Partial<ConsentTexts>> = {}): ConsentTexts {
  const base = builtin[lang] ?? builtin[lang.split("-")[0]] ?? builtin.en;
  const override = custom[lang] ?? {};
  return {
    title: override.title || base.title,
    text: override.text || base.text,
    accept: override.accept || base.accept,
    reject: override.reject || base.reject,
  };
}

export const CONSENT_COOKIE = "np_consent";
