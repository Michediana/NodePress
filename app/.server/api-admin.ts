import { eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "./api";
import { db, schema } from "./db";

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

export const nodeUpdateSchema = z.object({
  parentId: z.number().int().nullable().optional(),
  template: z.string().optional(),
  itemTemplate: z.string().nullish(),
  perPage: z.number().int().min(1).max(100).optional(),
});
