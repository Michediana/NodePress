import { eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";

export type MediaFormat = "webp" | "avif";

export type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

export type { ConsentTexts } from "~/lib/consent";
import type { ConsentTexts } from "~/lib/consent";
import type { CspMode } from "~/lib/csp";

export type SettingsMap = {
  siteName: string;
  siteUrl: string; // URL pubblico, es. https://www.esempio.it (vuoto = origin della richiesta)
  publicApi: boolean;
  smtp: SmtpSettings;
  mediaFormat: MediaFormat;
  mediaQuality: number;
  mediaMaxSize: number;
  robotsTxt: string | null; // null = generato in automatico
  llmsTxt: string | null; // null = generato in automatico
  ga4Id: string;
  gtmId: string;
  clarityId: string;
  consentTexts: Record<string, ConsentTexts>;
  analyticsEnabled: boolean; // analytics interne, senza cookie
  analyticsConsent: boolean; // raccogli solo dopo il consenso del banner
  analyticsRetentionDays: number; // giorni di conservazione dei dati grezzi
  activeTheme: string; // nome del tema attivo sul front
  cspMode: CspMode; // Content Security Policy del front
};

export const defaultSettings: SettingsMap = {
  siteName: "NodePress",
  siteUrl: "",
  publicApi: false,
  smtp: { host: "", port: 587, secure: false, user: "", pass: "", from: "" },
  mediaFormat: "webp",
  mediaQuality: 80,
  mediaMaxSize: 2560,
  robotsTxt: null,
  llmsTxt: null,
  ga4Id: "",
  gtmId: "",
  clarityId: "",
  consentTexts: {},
  analyticsEnabled: true,
  analyticsConsent: false,
  analyticsRetentionDays: 395,
  activeTheme: "default",
  cspMode: "enforce",
};

export type SettingKey = keyof SettingsMap;

export async function getSettings<K extends SettingKey>(keys: K[]): Promise<Pick<SettingsMap, K>> {
  const rows = await db
    .select()
    .from(schema.settings)
    .where(inArray(schema.settings.key, keys as string[]));
  const result = {} as Pick<SettingsMap, K>;
  for (const key of keys) {
    const row = rows.find((r) => r.key === key);
    result[key] = (row ? row.value : defaultSettings[key]) as SettingsMap[K];
  }
  return result;
}

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingsMap[K]> {
  return (await getSettings([key]))[key];
}

export async function getAllSettings(): Promise<SettingsMap> {
  return getSettings(Object.keys(defaultSettings) as SettingKey[]);
}

export async function setSettings(values: Partial<SettingsMap>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const existing = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
    if (existing.length) {
      await db.update(schema.settings).set({ value }).where(eq(schema.settings.key, key));
    } else {
      await db.insert(schema.settings).values({ key, value });
    }
  }
}

/** URL base del sito, senza slash finale. */
export async function getSiteUrl(request: Request) {
  const configured = (await getSetting("siteUrl")).trim().replace(/\/+$/, "");
  return configured || new URL(request.url).origin;
}
