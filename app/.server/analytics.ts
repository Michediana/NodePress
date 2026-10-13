import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, gte, lt, sql, type SQL } from "drizzle-orm";
import type { MySqlColumn } from "drizzle-orm/mysql-core";
import { isbot } from "isbot";
import { z } from "zod";
import { CHANNELS, type AnalyticsRange, type Channel } from "~/lib/analytics";
import { CONSENT_COOKIE } from "~/lib/consent";
import { db, schema } from "./db";
import { isAdminHost } from "./origins";
import { getSettings } from "./settings";

// Analytics interne, pensate per il GDPR e la direttiva ePrivacy:
// - nessun cookie né localStorage: il browser non conserva nulla che identifichi il visitatore;
// - l'IP serve solo a calcolare in memoria un hash con un sale casuale che cambia ogni giorno e
//   viene sovrascritto, quindi non si salva mai e le visite di giorni diversi non sono collegabili;
// - Do Not Track e Global Privacy Control vengono rispettati, i bot scartati;
// - gli URL perdono query string e frammento (solo i parametri utm_* vengono letti), indirizzi email
//   nei percorsi vengono mascherati, dei referrer resta origine e percorso;
// - i dati più vecchi della retention vengono cancellati in automatico;
// - se richiesto, la raccolta parte solo dopo il consenso dato nel banner.

const { analyticsSessions: sessions, analyticsEvents: events } = schema;

const SESSION_TIMEOUT = 30 * 60 * 1000;
const MAX_BODY = 8 * 1024;

// --- Sale giornaliero ---

type Salt = { day: string; salt: string };
const SALT_KEY = "analyticsSalt";
let saltCache: Salt | null = null;

/** Sale del giorno (UTC): quello di ieri viene sovrascritto e l'hash del visitatore non è più ricostruibile. */
async function dailySalt() {
  const day = new Date().toISOString().slice(0, 10);
  if (saltCache?.day === day) return saltCache.salt;
  const read = async () =>
    (await db.select().from(schema.settings).where(eq(schema.settings.key, SALT_KEY)))[0]?.value as Salt | undefined;
  const stored = await read();
  if (stored?.day !== day) {
    const fresh: Salt = { day, salt: randomBytes(32).toString("hex") };
    if (stored) {
      // Con più processi aggiorna solo il primo: gli altri rileggono il sale già ruotato.
      await db
        .update(schema.settings)
        .set({ value: fresh })
        .where(
          and(
            eq(schema.settings.key, SALT_KEY),
            sql`JSON_UNQUOTE(JSON_EXTRACT(${schema.settings.value}, '$.day')) <> ${day}`,
          ),
        );
    } else {
      await db
        .insert(schema.settings)
        .values({ key: SALT_KEY, value: fresh })
        .onDuplicateKeyUpdate({ set: { key: SALT_KEY } });
    }
  }
  saltCache = (await read()) ?? null;
  return saltCache!.salt;
}

// --- Dati della richiesta ---

function clientIp(request: Request) {
  const headers = request.headers;
  return (
    headers.get("CF-Connecting-IP") ??
    headers.get("X-Forwarded-For")?.split(",")[0].trim() ??
    headers.get("X-Real-IP") ??
    ""
  );
}

/** Paese dagli header di CDN e proxy (Cloudflare, Vercel, CloudFront…), se presenti. Nessun database GeoIP. */
function countryOf(request: Request) {
  for (const name of [
    "CF-IPCountry",
    "X-Vercel-IP-Country",
    "CloudFront-Viewer-Country",
    "X-Country-Code",
    "X-Geo-Country",
  ]) {
    const value = request.headers.get(name)?.trim().toUpperCase();
    if (value && /^[A-Z]{2}$/.test(value) && value !== "XX" && value !== "T1") return value;
  }
  return null;
}

function hasConsent(request: Request) {
  const match = (request.headers.get("Cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${CONSENT_COOKIE}=([^;]*)`));
  return match?.[1] === "granted";
}

/** Limite grezzo per IP, in memoria: evita che un singolo client riempia il database. */
const hits = new Map<string, number>();
let hitsWindow = 0;
function rateLimited(ip: string) {
  const minute = Math.floor(Date.now() / 60000);
  if (minute !== hitsWindow) {
    hits.clear();
    hitsWindow = minute;
  }
  const count = (hits.get(ip) ?? 0) + 1;
  hits.set(ip, count);
  return count > 240;
}

type Agent = {
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  device: "desktop" | "mobile" | "tablet";
};

const BROWSERS: [string, RegExp][] = [
  ["Edge", /Edg(?:e|A|iOS)?\/(\d+)/],
  ["Opera", /(?:OPR|Opera)\/(\d+)/],
  ["Samsung Internet", /SamsungBrowser\/(\d+)/],
  ["Yandex", /YaBrowser\/(\d+)/],
  ["Vivaldi", /Vivaldi\/(\d+)/],
  ["Firefox", /(?:Firefox|FxiOS)\/(\d+)/],
  ["Chrome", /(?:Chrome|CriOS)\/(\d+)/],
  ["Safari", /Version\/(\d+(?:\.\d+)?).*Safari/],
];

const WINDOWS: Record<string, string> = { "10.0": "10/11", "6.3": "8.1", "6.2": "8", "6.1": "7" };

/** Browser, sistema e tipo di dispositivo dallo user agent: solo versioni principali. */
export function parseUserAgent(ua: string, touchPoints = 0): Agent {
  let browser: string | null = null;
  let browserVersion: string | null = null;
  for (const [name, pattern] of BROWSERS) {
    const match = pattern.exec(ua);
    if (match) {
      browser = name;
      browserVersion = match[1];
      break;
    }
  }
  let os: string | null = null;
  let osVersion: string | null = null;
  let match: RegExpExecArray | null;
  if ((match = /(?:iPhone|iPad|iPod).*? OS (\d+)/.exec(ua))) [os, osVersion] = ["iOS", match[1]];
  else if ((match = /Android (\d+)/.exec(ua))) [os, osVersion] = ["Android", match[1]];
  else if ((match = /Windows NT ([\d.]+)/.exec(ua))) [os, osVersion] = ["Windows", WINDOWS[match[1]] ?? match[1]];
  else if ((match = /Mac OS X (\d+)[_.](\d+)/.exec(ua)))
    [os, osVersion] = ["macOS", match[1] === "10" ? `10.${match[2]}` : match[1]];
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";

  let device: Agent["device"] = "desktop";
  // iPadOS si presenta come un Mac: lo distinguono solo i punti di tocco.
  if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) || (os === "macOS" && touchPoints > 1))
    device = "tablet";
  else if (/Mobi|iPhone|iPod|Android/.test(ua)) device = "mobile";
  if (os === "macOS" && device === "tablet") os = "iOS";
  return { browser, browserVersion, os, osVersion, device };
}

const SEARCH =
  /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|yandex|baidu|qwant|startpage|brave|ask|aol|seznam|naver)\.[a-z.]+$/;
const SOCIAL =
  /(^|\.)(facebook|fb|instagram|t\.co|twitter|x|linkedin|lnkd\.in|reddit|pinterest|tiktok|youtube|threads|bsky|mastodon|tumblr|whatsapp|telegram|snapchat|vk)\.?[a-z.]*$/;
const AI =
  /(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|you\.com|phind\.com|mistral\.ai)$/;

/** Canale di acquisizione: campagne UTM prima, poi il dominio del referrer. */
export function channelOf(referrerHost: string | null, utm: Record<string, string | null>): Channel {
  const medium = (utm.medium ?? "").toLowerCase();
  if (medium) {
    if (/cpc|ppc|paid|display|cpm|banner/.test(medium)) return "paid";
    if (/e-?mail|newsletter/.test(medium)) return "email";
    if (/social/.test(medium)) return "social";
    return "campaign";
  }
  if (utm.source) return "campaign";
  if (!referrerHost) return "direct";
  if (AI.test(referrerHost)) return "ai";
  if (SEARCH.test(referrerHost)) return "search";
  if (SOCIAL.test(referrerHost)) return "social";
  return "referral";
}

/** Percorso senza query string e frammento, con eventuali email mascherate. */
function cleanPath(value: string) {
  let path = value.split(/[?#]/)[0] || "/";
  if (!path.startsWith("/")) path = "/" + path;
  try {
    path = decodeURI(path);
  } catch {
    // percorso con escape non validi: resta com'è
  }
  return path.replace(/[^/@\s]+@[^/@\s]+\.[a-z]{2,}/gi, "[email]").slice(0, 700);
}

/** Referrer esterno ridotto a origine + percorso; null se manca o è interno al sito. */
function cleanReferrer(value: string | undefined, siteHost: string) {
  if (!value) return { host: null, url: null };
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.host === siteHost) return { host: null, url: null };
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return { host: host.slice(0, 255), url: (url.origin + cleanPath(url.pathname)).slice(0, 1000) };
  } catch {
    return { host: null, url: null };
  }
}

// --- Payload ---

const text = (max: number) =>
  z
    .string()
    .max(2000)
    .transform((v) => v.trim().slice(0, max) || undefined);
const int = (max: number) => z.number().int().min(0).max(max);
const viewId = z.string().regex(/^[A-Za-z0-9]{8,24}$/);
const path = z.string().max(4000).transform(cleanPath);
const props = z
  .record(z.string().regex(/^[\w.-]{1,40}$/), z.union([z.string().max(500), z.number(), z.boolean()]))
  .refine((v) => Object.keys(v).length <= 10, "Troppe proprietà")
  .transform((v) =>
    Object.fromEntries(Object.entries(v).map(([k, val]) => [k, typeof val === "string" ? cleanPropValue(val) : val])),
  );

/** I valori stringa delle proprietà perdono le query string degli URL e le email. */
function cleanPropValue(value: string) {
  return value
    .replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, "$1")
    .replace(/[^\s@/]+@[^\s@/]+\.[a-z]{2,}/gi, "[email]")
    .slice(0, 200);
}

const hitSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("pv"),
    v: viewId,
    p: path,
    ti: text(255).optional(),
    l: text(16).optional(),
    n: z.number().int().positive().optional(),
    s: z.number().int().min(100).max(599).optional(),
    r: z.string().max(4000).optional(),
    pp: path.optional(),
    u: z
      .object({ source: text(255), medium: text(255), campaign: text(255), term: text(255), content: text(255) })
      .partial()
      .optional(),
    sw: int(20000).optional(),
    sh: int(20000).optional(),
    dpr: z.number().min(0).max(10).optional(),
    bl: text(16).optional(),
    tz: text(64).optional(),
    cs: z.enum(["light", "dark"]).optional(),
    c: text(16).optional(),
    tp: int(20).optional(),
  }),
  z.object({
    t: z.literal("lv"),
    v: viewId,
    e: int(24 * 3600 * 1000),
    d: int(100).optional(),
    w: z
      .object({ ttfb: int(600000), fcp: int(600000), lcp: int(600000), cls: int(100000), inp: int(600000) })
      .partial()
      .optional(),
  }),
  z.object({
    t: z.literal("ev"),
    v: viewId,
    p: path,
    n: z.string().regex(/^[\w .:/-]{1,64}$/),
    pr: props.optional(),
  }),
]);

type Hit = z.infer<typeof hitSchema>;

async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

// --- Raccolta ---

/** Riceve un dato dal front. Risponde sempre senza corpo: il browser non riceve nulla da conservare. */
export async function collect(request: Request) {
  if (request.method !== "POST") return 405;
  if (isAdminHost(request)) return 403;
  const ua = request.headers.get("User-Agent") ?? "";
  if (!ua || isbot(ua) || request.headers.get("DNT") === "1" || request.headers.get("Sec-GPC") === "1") return 204;
  const settings = await getSettings(["analyticsEnabled", "analyticsConsent", "analyticsRetentionDays"]);
  if (!settings.analyticsEnabled || (settings.analyticsConsent && !hasConsent(request))) return 204;
  const ip = clientIp(request);
  if (rateLimited(ip)) return 429;
  const parsed = hitSchema.safeParse(await readBody(request));
  if (!parsed.success) return 400;

  const siteHost = new URL(request.url).host;
  const visitor = createHash("sha256")
    .update(`${await dailySalt()}|${siteHost}|${ip}|${ua}`)
    .digest("hex")
    .slice(0, 32);
  const hit = parsed.data;
  if (hit.t === "pv") await recordPageview(request, hit, visitor, siteHost, ua);
  else if (hit.t === "lv") await recordLeave(hit, visitor);
  else await recordEvent(hit, visitor);

  void purgeExpired(settings.analyticsRetentionDays);
  return 204;
}

async function activeSession(visitor: string, now: Date) {
  const [session] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.visitorHash, visitor), gt(sessions.lastSeenAt, new Date(now.getTime() - SESSION_TIMEOUT))))
    .orderBy(desc(sessions.lastSeenAt))
    .limit(1);
  return session ?? null;
}

async function recordPageview(
  request: Request,
  hit: Extract<Hit, { t: "pv" }>,
  visitor: string,
  siteHost: string,
  ua: string,
) {
  const now = new Date();
  let session = await activeSession(visitor, now);
  if (session) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now, exitPath: hit.p, pageviews: sql`${sessions.pageviews} + 1` })
      .where(eq(sessions.id, session.id));
  } else {
    const referrer = cleanReferrer(hit.r, siteHost);
    const utm = {
      source: hit.u?.source ?? null,
      medium: hit.u?.medium ?? null,
      campaign: hit.u?.campaign ?? null,
      term: hit.u?.term ?? null,
      content: hit.u?.content ?? null,
    };
    const [result] = await db.insert(sessions).values({
      visitorHash: visitor,
      startedAt: now,
      lastSeenAt: now,
      entryPath: hit.p,
      exitPath: hit.p,
      pageviews: 1,
      channel: channelOf(referrer.host, utm),
      referrerHost: referrer.host,
      referrerUrl: referrer.url,
      utmSource: utm.source,
      utmMedium: utm.medium,
      utmCampaign: utm.campaign,
      utmTerm: utm.term,
      utmContent: utm.content,
      country: countryOf(request),
      lang: hit.l ?? null,
      browserLang: hit.bl ?? null,
      timezone: hit.tz ?? null,
      ...parseUserAgent(ua, hit.tp),
      screenWidth: hit.sw ?? null,
      screenHeight: hit.sh ?? null,
      pixelRatio: hit.dpr ?? null,
      colorScheme: hit.cs ?? null,
      connection: hit.c ?? null,
    });
    session = { id: result.insertId };
  }
  await db.insert(events).values({
    sessionId: session.id,
    type: "pageview",
    viewId: hit.v,
    path: hit.p,
    title: hit.ti ?? null,
    lang: hit.l ?? null,
    nodeId: hit.n ?? null,
    status: hit.s ?? 200,
    previousPath: hit.pp ?? null,
    createdAt: now,
  });
}

/** Pagina vista a cui appartiene un id, solo se dello stesso visitatore. */
async function viewOf(viewId: string, visitor: string) {
  const [view] = await db
    .select({ id: events.id, sessionId: events.sessionId, engagedMs: events.engagedMs, lang: events.lang })
    .from(events)
    .innerJoin(sessions, eq(sessions.id, events.sessionId))
    .where(and(eq(events.viewId, viewId), eq(events.type, "pageview"), eq(sessions.visitorHash, visitor)))
    .limit(1);
  return view ?? null;
}

/** Uscita dalla pagina: tempo attivo, scroll e Web Vitals. Può arrivare più volte (tab nascosta e ripresa). */
async function recordLeave(hit: Extract<Hit, { t: "lv" }>, visitor: string) {
  const view = await viewOf(hit.v, visitor);
  if (!view) return;
  const before = view.engagedMs ?? 0;
  const engaged = Math.max(before, hit.e);
  const vitals = hit.w ?? {};
  await db
    .update(events)
    .set({
      engagedMs: engaged,
      scrollDepth: hit.d === undefined ? undefined : sql`GREATEST(COALESCE(${events.scrollDepth}, 0), ${hit.d})`,
      ttfb: vitals.ttfb,
      fcp: vitals.fcp,
      lcp: vitals.lcp,
      cls: vitals.cls,
      inp: vitals.inp,
    })
    .where(eq(events.id, view.id));
  const delta = Math.round(engaged / 1000) - Math.round(before / 1000);
  await db
    .update(sessions)
    .set({
      engagedSeconds: sql`${sessions.engagedSeconds} + ${delta}`,
      lastSeenAt: sql`GREATEST(${sessions.lastSeenAt}, ${new Date()})`,
    })
    .where(eq(sessions.id, view.sessionId));
}

async function recordEvent(hit: Extract<Hit, { t: "ev" }>, visitor: string) {
  const now = new Date();
  const view = await viewOf(hit.v, visitor);
  const sessionId = view?.sessionId ?? (await activeSession(visitor, now))?.id;
  if (!sessionId) return;
  await db.insert(events).values({
    sessionId,
    type: "event",
    name: hit.n,
    viewId: hit.v,
    path: hit.p,
    lang: view?.lang ?? null,
    props: hit.pr && Object.keys(hit.pr).length ? hit.pr : null,
    createdAt: now,
  });
  await db
    .update(sessions)
    .set({ events: sql`${sessions.events} + 1`, lastSeenAt: sql`GREATEST(${sessions.lastSeenAt}, ${now})` })
    .where(eq(sessions.id, sessionId));
}

// --- Retention ---

let lastPurge = 0;

/** Cancella i dati più vecchi della retention, a lotti; al massimo una volta l'ora per processo. */
export async function purgeExpired(days: number, force = false) {
  if (!force && Date.now() - lastPurge < 3600_000) return;
  lastPurge = Date.now();
  const cutoff = new Date(Date.now() - days * 86400_000);
  try {
    for (const [table, column] of [
      [events, events.createdAt],
      [sessions, sessions.lastSeenAt],
    ] as const) {
      for (;;) {
        const [result] = await db.delete(table).where(lt(column, cutoff)).limit(5000);
        if (result.affectedRows < 5000) break;
      }
    }
  } catch (error) {
    lastPurge = 0;
    console.error("Pulizia analytics non riuscita:", error);
  }
}

/** Elimina tutti i dati raccolti e ruota il sale. */
export async function clearAnalytics() {
  await db.delete(events);
  await db.delete(sessions);
  await db.delete(schema.settings).where(eq(schema.settings.key, SALT_KEY));
  saltCache = null;
}

// --- Report ---

const n = (value: unknown) => Number(value ?? 0);

export type Row = { label: string; value: number; secondary?: number };
export type SeriesPoint = {
  bucket: string;
  visitors: number;
  visits: number;
  pageviews: number;
  bounceRate: number;
  duration: number;
};
export type Vital = {
  name: "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
  p75: number | null;
  samples: number;
  good: number;
  poor: number;
};

const VITALS: { name: Vital["name"]; key: "lcp" | "inp" | "cls" | "fcp" | "ttfb"; good: number; poor: number }[] = [
  { name: "LCP", key: "lcp", good: 2500, poor: 4000 },
  { name: "INP", key: "inp", good: 200, poor: 500 },
  { name: "CLS", key: "cls", good: 100, poor: 250 },
  { name: "FCP", key: "fcp", good: 1800, poor: 3000 },
  { name: "TTFB", key: "ttfb", good: 800, poor: 1800 },
];

const bounce = sql<number>`SUM(CASE WHEN ${sessions.pageviews} <= 1 AND ${sessions.events} = 0 AND ${sessions.engagedSeconds} < 10 THEN 1 ELSE 0 END)`;

async function kpis(from: Date, to: Date) {
  const [row] = await db
    .select({
      visits: sql<number>`COUNT(*)`,
      visitors: sql<number>`COUNT(DISTINCT ${sessions.visitorHash})`,
      pageviews: sql<number>`COALESCE(SUM(${sessions.pageviews}), 0)`,
      bounces: bounce,
      duration: sql<number>`COALESCE(AVG(${sessions.engagedSeconds}), 0)`,
    })
    .from(sessions)
    .where(and(gte(sessions.startedAt, from), lt(sessions.startedAt, to)));
  const visits = n(row.visits);
  return {
    visitors: n(row.visitors),
    visits,
    pageviews: n(row.pageviews),
    bounceRate: visits ? Math.round((n(row.bounces) / visits) * 100) : 0,
    duration: Math.round(n(row.duration)),
    pagesPerVisit: visits ? Math.round((n(row.pageviews) / visits) * 10) / 10 : 0,
  };
}

/** Vista per una colonna delle sessioni: visite e visitatori per valore. */
function sessionBreakdown(column: MySqlColumn | SQL, where: SQL | undefined, limit = 10) {
  return db
    .select({
      label: sql<string>`${column}`,
      value: sql<number>`COUNT(*)`,
      secondary: sql<number>`COUNT(DISTINCT ${sessions.visitorHash})`,
    })
    .from(sessions)
    .where(and(where, sql`${column} IS NOT NULL`, sql`${column} <> ''`))
    .groupBy(sql`1`)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(limit)
    .then((rows) => rows.map((r) => ({ label: String(r.label), value: n(r.value), secondary: n(r.secondary) })));
}

function eventBreakdown(column: MySqlColumn | SQL, where: SQL | undefined, limit = 10) {
  return db
    .select({
      label: sql<string>`${column}`,
      value: sql<number>`COUNT(*)`,
      secondary: sql<number>`COUNT(DISTINCT ${events.sessionId})`,
    })
    .from(events)
    .where(and(where, sql`${column} IS NOT NULL`))
    .groupBy(sql`1`)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(limit)
    .then((rows) => rows.map((r) => ({ label: String(r.label), value: n(r.value), secondary: n(r.secondary) })));
}

function p75(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.75) - 1)];
}

export async function getAnalyticsReport(range: AnalyticsRange) {
  const days = Number(range);
  const hourly = days === 1;
  const now = new Date();
  // Periodo allineato all'ora (24 ore) o al giorno UTC, così i bucket del grafico sono completi.
  const to = hourly
    ? new Date(Math.ceil(now.getTime() / 3600_000) * 3600_000)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const from = new Date(to.getTime() - days * 86400_000);
  const prevFrom = new Date(from.getTime() - days * 86400_000);
  const inRange = and(gte(sessions.startedAt, from), lt(sessions.startedAt, to));
  const eventsInRange = and(gte(events.createdAt, from), lt(events.createdAt, to));
  const pageviews = and(eventsInRange, eq(events.type, "pageview"));
  const named = (name: string) => and(eventsInRange, eq(events.type, "event"), eq(events.name, name));
  const prop = (key: string) => sql`JSON_UNQUOTE(JSON_EXTRACT(${events.props}, ${"$." + key}))`;
  const format = hourly ? "%Y-%m-%dT%H:00" : "%Y-%m-%d";
  const bucket = sql<string>`DATE_FORMAT(${sessions.startedAt}, ${format})`;

  const [
    current,
    previous,
    [live],
    seriesRows,
    pages,
    entries,
    exits,
    notFound,
    channels,
    referrers,
    sources,
    mediums,
    campaigns,
    countries,
    langs,
    browserLangs,
    timezones,
    browsers,
    oses,
    devices,
    screens,
    schemes,
    connections,
    eventNames,
    outbound,
    downloads,
    vitalRows,
  ] = await Promise.all([
    kpis(from, to),
    kpis(prevFrom, from),
    db
      .select({ n: sql<number>`COUNT(DISTINCT ${sessions.visitorHash})` })
      .from(sessions)
      .where(gt(sessions.lastSeenAt, new Date(now.getTime() - 5 * 60_000))),
    db
      .select({
        bucket,
        visits: sql<number>`COUNT(*)`,
        visitors: sql<number>`COUNT(DISTINCT ${sessions.visitorHash})`,
        pageviews: sql<number>`COALESCE(SUM(${sessions.pageviews}), 0)`,
        bounces: bounce,
        duration: sql<number>`COALESCE(AVG(${sessions.engagedSeconds}), 0)`,
      })
      .from(sessions)
      .where(inRange)
      .groupBy(sql`1`),
    db
      .select({
        label: events.path,
        title: sql<string>`MAX(${events.title})`,
        value: sql<number>`COUNT(*)`,
        secondary: sql<number>`COUNT(DISTINCT ${events.sessionId})`,
        engaged: sql<number>`AVG(${events.engagedMs})`,
        scroll: sql<number>`AVG(${events.scrollDepth})`,
      })
      .from(events)
      .where(pageviews)
      .groupBy(events.path)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(15),
    sessionBreakdown(sessions.entryPath, inRange),
    sessionBreakdown(sessions.exitPath, inRange),
    eventBreakdown(events.path, and(pageviews, eq(events.status, 404))),
    sessionBreakdown(sessions.channel, inRange),
    sessionBreakdown(sessions.referrerHost, inRange),
    sessionBreakdown(sessions.utmSource, inRange),
    sessionBreakdown(sessions.utmMedium, inRange),
    sessionBreakdown(sessions.utmCampaign, inRange),
    sessionBreakdown(sessions.country, inRange, 15),
    sessionBreakdown(sessions.lang, inRange),
    sessionBreakdown(sessions.browserLang, inRange),
    sessionBreakdown(sessions.timezone, inRange),
    sessionBreakdown(sessions.browser, inRange),
    sessionBreakdown(sessions.os, inRange),
    sessionBreakdown(sessions.device, inRange),
    sessionBreakdown(sql`CONCAT(${sessions.screenWidth}, '×', ${sessions.screenHeight})`, inRange),
    sessionBreakdown(sessions.colorScheme, inRange),
    sessionBreakdown(sessions.connection, inRange),
    eventBreakdown(events.name, and(eventsInRange, eq(events.type, "event")), 15),
    eventBreakdown(prop("url"), named("outbound")),
    eventBreakdown(prop("file"), named("download")),
    db
      .select({ ttfb: events.ttfb, fcp: events.fcp, lcp: events.lcp, cls: events.cls, inp: events.inp })
      .from(events)
      .where(
        and(pageviews, sql`(${events.lcp} IS NOT NULL OR ${events.ttfb} IS NOT NULL OR ${events.inp} IS NOT NULL)`),
      )
      .orderBy(desc(events.id))
      .limit(20000),
  ]);

  // Serie completa, con i bucket vuoti a zero.
  const byBucket = new Map(seriesRows.map((r) => [r.bucket, r]));
  const series: SeriesPoint[] = [];
  const step = hourly ? 3600_000 : 86400_000;
  for (let time = from.getTime(); time < to.getTime(); time += step) {
    const key = new Date(time).toISOString().slice(0, hourly ? 13 : 10) + (hourly ? ":00" : "");
    const row = byBucket.get(key);
    const visits = n(row?.visits);
    series.push({
      bucket: key,
      visits,
      visitors: n(row?.visitors),
      pageviews: n(row?.pageviews),
      bounceRate: visits ? Math.round((n(row?.bounces) / visits) * 100) : 0,
      duration: Math.round(n(row?.duration)),
    });
  }

  const vitals: Vital[] = VITALS.map(({ name, key, good, poor }) => {
    const values = vitalRows.map((r) => r[key]).filter((v): v is number => v !== null);
    return {
      name,
      p75: p75(values),
      samples: values.length,
      good: values.filter((v) => v <= good).length,
      poor: values.filter((v) => v > poor).length,
    };
  });

  return {
    range,
    hourly,
    from: from.toISOString(),
    to: to.toISOString(),
    live: n(live?.n),
    current,
    previous,
    series,
    pages: pages.map((p) => ({
      label: p.label,
      title: p.title,
      value: n(p.value),
      secondary: n(p.secondary),
      engaged: Math.round(n(p.engaged) / 1000),
      scroll: Math.round(n(p.scroll)),
    })),
    entries,
    exits,
    notFound,
    channels: channels.filter((c) => (CHANNELS as readonly string[]).includes(c.label)),
    referrers,
    sources,
    mediums,
    campaigns,
    countries,
    langs,
    browserLangs,
    timezones,
    browsers,
    oses,
    devices,
    screens,
    schemes,
    connections,
    eventNames,
    outbound,
    downloads,
    vitals,
  };
}

export type AnalyticsReport = Awaited<ReturnType<typeof getAnalyticsReport>>;
