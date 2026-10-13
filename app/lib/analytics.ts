// Costanti condivise tra lo script di raccolta del front e il server.

/** Endpoint che riceve i dati: sulla stessa origine del sito, nessuna richiesta a terzi. */
export const ANALYTICS_ENDPOINT = "/_np/a";

/** Evento emesso dal banner quando il visitatore sceglie (detail: "granted" | "denied"). */
export const CONSENT_CHANGE_EVENT = "np:consent";

export const ANALYTICS_RANGES = ["1", "7", "30", "90", "365"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export const CHANNELS = ["direct", "search", "social", "ai", "referral", "email", "paid", "campaign"] as const;
export type Channel = (typeof CHANNELS)[number];
