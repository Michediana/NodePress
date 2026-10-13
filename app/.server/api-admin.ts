import { eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "./api";
import { db, schema } from "./db";
import { createNode, deleteNode, saveTranslation } from "./nodes";
import { getAllSettings, setSettings } from "./settings";
import { getTemplateOptions } from "./theme";
import { kindOfNode } from "~/lib/theme/manifest";

/** Nodo completo (tutte le traduzioni, anche bozze) per le API admin. */
export async function adminNode(id: number) {
  const node = await db.query.nodes.findFirst({ where: eq(schema.nodes.id, id), with: { translations: true } });
  if (!node) throw new ApiError(404, "Nodo non trovato.");
  return node;
}

export const translationSchema = z.object({
  title: z.string().trim().min(1).max(255),
  slug: z.string().trim().max(191),
  excerpt: z.string().max(5000).nullish(),
  content: z
    .object({ type: z.literal("doc"), content: z.array(z.any()).optional() })
    .nullish(),
  status: z.enum(["draft", "published", "scheduled"]).default("draft"),
  publishedAt: z.coerce.date().nullish(),
  seoTitle: z.string().max(255).nullish(),
  seoDescription: z.string().max(1000).nullish(),
  focusKeyword: z.string().max(255).nullish(),
  ogImageId: z.number().int().nullish(),
  noindex: z.boolean().optional(),
});

export const nodeSchema = z.object({
  parentId: z.number().int().nullable().default(null),
  type: z.enum(["page", "collection", "item"]),
  template: z.string().optional(),
  itemTemplate: z.string().nullish(),
  perPage: z.number().int().min(1).max(100).optional(),
  translations: z.record(z.string(), translationSchema).optional(),
});

/** Crea un nodo con le sue traduzioni; se una traduzione non è valida il nodo viene eliminato. */
export async function createNodeWithTranslations(userId: number | null, input: z.infer<typeof nodeSchema>) {
  const { defaults } = await getTemplateOptions();
  const id = await createNode(userId, {
    parentId: input.parentId,
    type: input.type,
    template: input.template ?? defaults[kindOfNode(input.type)],
    itemTemplate: input.type === "collection" ? (input.itemTemplate ?? defaults.item) : null,
    perPage: input.perPage,
  });
  try {
    for (const [lang, translation] of Object.entries(input.translations ?? {})) {
      await saveTranslation(id, lang, translation);
    }
  } catch (error) {
    await deleteNode(id);
    throw error;
  }
  return adminNode(id);
}

export const nodeUpdateSchema = z.object({
  parentId: z.number().int().nullable().optional(),
  template: z.string().optional(),
  itemTemplate: z.string().nullish(),
  perPage: z.number().int().min(1).max(100).optional(),
});

export const menuItemSchema = z.object({
  depth: z.number().int().min(0).max(5).default(0),
  nodeId: z.number().int().nullable().default(null),
  url: z.string().max(1000).nullable().default(null),
  newTab: z.boolean().default(false),
  labels: z.record(z.string(), z.string().max(255)).default({}),
});

export const menuSchema = z.object({
  name: z.string().trim().min(1).max(255),
  location: z.string().max(64).nullish(),
  items: z.array(menuItemSchema).optional(),
});

export const redirectSchema = z.object({
  fromPath: z.string().min(1).max(700),
  toPath: z.string().min(1).max(1000),
  statusCode: z.number().int().default(301),
});

export const settingsPatchSchema = z
  .object({
    siteName: z.string().min(1).max(255),
    siteUrl: z.string().max(255),
    publicApi: z.boolean(),
    mediaFormat: z.enum(["webp", "avif"]),
    mediaQuality: z.number().int().min(1).max(100),
    mediaMaxSize: z.number().int().min(320).max(10000),
    robotsTxt: z.string().nullable(),
    llmsTxt: z.string().nullable(),
    ga4Id: z.string().max(64),
    gtmId: z.string().max(64),
    clarityId: z.string().max(64),
    smtp: z.object({
      host: z.string(),
      port: z.number().int(),
      secure: z.boolean(),
      user: z.string(),
      pass: z.string(),
      from: z.string(),
    }),
    consentTexts: z.record(z.string(), z.object({ title: z.string(), text: z.string(), accept: z.string(), reject: z.string() })),
    cspMode: z.enum(["enforce", "report-only", "off"]),
  })
  .partial();

const MASKED_PASSWORD = "********";

/** Impostazioni per le API, con la password SMTP mascherata. */
export async function maskedSettings() {
  const settings = await getAllSettings();
  return { ...settings, smtp: { ...settings.smtp, pass: settings.smtp.pass ? MASKED_PASSWORD : "" } };
}

/** Aggiorna le impostazioni; la password mascherata rimanda a quella salvata. */
export async function patchSettings(input: z.infer<typeof settingsPatchSchema>) {
  if (input.smtp?.pass === MASKED_PASSWORD) input.smtp.pass = (await getAllSettings()).smtp.pass;
  await setSettings(input);
  return maskedSettings();
}
