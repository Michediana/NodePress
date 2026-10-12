import { z } from "zod";
import {
  isBind,
  isLocalized,
  isResponsive,
  type Visibility,
  SETTING_TYPES,
  type SectionNode,
  type SectionSchema,
  type SectionTree,
  type SettingDef,
} from "~/lib/theme/sections";
import { ThemeCompileError } from "./compile";

// Validazione degli schemi delle sezioni (frontmatter) e degli alberi di sezioni (JSON).
// Gli errori indicano il percorso nel JSON (es. sections[1].settings.title), perché il JSON
// non conserva le righe dopo il parsing.

const optionSchema = z.union([z.string(), z.object({ value: z.string(), label: z.string() })]);

const settingSchema = z.object({
  type: z.enum(SETTING_TYPES),
  label: z.string().optional(),
  help: z.string().optional(),
  default: z.unknown().optional(),
  options: z.array(optionSchema).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  placeholder: z.string().optional(),
  responsive: z.boolean().optional(),
});

const slotSchema = z.object({ label: z.string().optional(), accepts: z.array(z.string()).optional() });

const schemaSchema = z.object({
  label: z.string().min(1).optional(),
  description: z.string().optional(),
  inContent: z.boolean().default(true),
  settings: z.record(z.string().regex(/^[a-zA-Z][\w]*$/, "nome non valido"), settingSchema).default({}),
  slots: z.union([z.array(z.string()), z.record(z.string(), slotSchema)]).default({}),
});

const fail = (file: string, message: string): never => {
  throw new ThemeCompileError(message, file, 1, 1);
};

const issuePath = (issue: z.core.$ZodIssue) =>
  issue.path
    .map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`))
    .join("")
    .replace(/^\./, "");

/** Schema di una sezione dal frontmatter di `sections/<tipo>.np`. */
export function parseSectionSchema(file: string, meta: unknown): SectionSchema {
  const name = file.slice("sections/".length, -".np".length);
  const parsed = schemaSchema.safeParse(meta ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    fail(file, `Frontmatter: ${issuePath(issue) || "schema"}: ${issue.message}`);
  }
  const data = parsed.data!;
  const settings: Record<string, SettingDef> = {};
  for (const [key, def] of Object.entries(data.settings)) {
    const options = def.options?.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
    if (def.type === "select" && !options?.length)
      fail(file, `Frontmatter: settings.${key}: un "select" richiede "options".`);
    settings[key] = { ...def, options };
  }
  const slots = Array.isArray(data.slots) ? Object.fromEntries(data.slots.map((s) => [s, {}])) : data.slots;
  return { name, label: data.label ?? name, description: data.description, settings, slots, inContent: data.inContent };
}

const visibilitySchema = z.object({
  hideOn: z.array(z.enum(["mobile", "tablet", "desktop"])).optional(),
  langs: z.array(z.string()).optional(),
  from: z.string().datetime({ offset: true, local: true }).optional(),
  until: z.string().datetime({ offset: true, local: true }).optional(),
});

const nodeSchema: z.ZodType<RawNode> = z.lazy(() =>
  z.object({
    id: z
      .string()
      .regex(/^[\w-]+$/, "solo lettere, numeri, - e _")
      .optional(),
    type: z.string(),
    settings: z.record(z.string(), z.unknown()).default({}),
    slots: z.record(z.string(), z.array(nodeSchema)).default({}),
    hidden: z.boolean().optional(),
    visibility: visibilitySchema.optional(),
    css: z.string().max(100_000).optional(),
  }),
);

type RawNode = {
  id?: string;
  type: string;
  settings: Record<string, unknown>;
  slots: Record<string, RawNode[]>;
  hidden?: boolean;
  visibility?: Visibility;
  css?: string;
};

const treeSchema = z.object({
  layout: z.string().nullable().optional(),
  sections: z.array(nodeSchema),
});

/** Controlla il tipo di un valore letterale rispetto alla definizione dell'impostazione. */
function checkValue(file: string, where: string, def: SettingDef, value: unknown) {
  if (value === null || value === undefined || isBind(value)) return;
  if (isResponsive(value)) {
    if (!def.responsive)
      fail(file, `${where}: valori per breakpoint ammessi solo con "responsive": true nello schema.`);
    for (const [bp, v] of Object.entries(value)) checkValue(file, `${where}.${bp}`, { ...def, responsive: false }, v);
    return;
  }
  // Testi e link possono essere tradotti: { "it": "…", "en": "…" }.
  if (["text", "textarea", "link"].includes(def.type) && isLocalized(value)) return;
  const bad = (expected: string) => fail(file, `${where}: atteso ${expected}.`);
  switch (def.type) {
    case "text":
    case "textarea":
    case "color":
    case "link":
      if (typeof value !== "string") bad(def.type === "color" ? "un colore" : 'un testo, o { "it": "…", "en": "…" }');
      break;
    case "number":
      if (typeof value !== "number") bad("un numero");
      break;
    case "boolean":
      if (typeof value !== "boolean") bad("true o false");
      break;
    case "select":
      if (!def.options?.some((o) => o.value === value))
        bad(`uno tra ${def.options?.map((o) => `"${o.value}"`).join(", ")}`);
      break;
    case "media":
      if (typeof value !== "number") bad("l'id di un media");
      break;
    case "items": {
      const query = value as { collection?: unknown; limit?: unknown };
      if (typeof value !== "object" || (typeof query.collection !== "number" && typeof query.collection !== "string")) {
        bad('{ "collection": <id o percorso>, "limit": <n> }');
      }
      if (query.limit !== undefined && (typeof query.limit !== "number" || query.limit < 1 || query.limit > 100)) {
        bad("un limit tra 1 e 100");
      }
      break;
    }
  }
}

/**
 * Valida un albero di sezioni e assegna gli id mancanti, stabili e derivati dalla posizione
 * (`home-0`, `home-0-actions-1`): servono a collegare i dati calcolati sul server.
 */
export function parseTree(
  file: string,
  source: string,
  schemas: Record<string, SectionSchema>,
  components: Set<string>,
): SectionTree {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    fail(file, `JSON non valido: ${(error as Error).message}`);
  }
  const parsed = treeSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    fail(file, `${issuePath(issue) || "albero"}: ${issue.message}`);
  }
  const tree = parsed.data!;
  if (tree.layout && !components.has(tree.layout)) fail(file, `layout: manca components/${tree.layout}.np.`);

  const base = file.replace(/^(templates|groups)\//, "").replace(/\.json$/, "");
  const ids = new Set<string>();
  const convert = (nodes: RawNode[], where: string, prefix: string, accepts?: string[]): SectionNode[] =>
    nodes.map((node, i) => {
      const at = `${where}[${i}]`;
      const schema = schemas[node.type];
      if (!schema) fail(file, `${at}.type: manca la sezione sections/${node.type}.np.`);
      if (accepts?.length && !accepts.includes(node.type))
        fail(file, `${at}.type: lo slot accetta solo ${accepts.join(", ")}.`);
      for (const [key, value] of Object.entries(node.settings)) {
        const def = schema.settings[key];
        if (!def) fail(file, `${at}.settings.${key}: impostazione non dichiarata in sections/${node.type}.np.`);
        checkValue(file, `${at}.settings.${key}`, def, value);
      }
      const id = node.id ?? `${prefix}-${i}`;
      if (ids.has(id)) fail(file, `${at}.id: "${id}" è già usato.`);
      ids.add(id);
      const slots: Record<string, SectionNode[]> = {};
      for (const [slot, children] of Object.entries(node.slots)) {
        if (!schema.slots[slot]) fail(file, `${at}.slots.${slot}: slot non dichiarato in sections/${node.type}.np.`);
        slots[slot] = convert(children, `${at}.slots.${slot}`, `${id}-${slot}`, schema.slots[slot].accepts);
      }
      return {
        id,
        type: node.type,
        settings: node.settings,
        slots,
        ...(node.hidden ? { hidden: true } : {}),
        ...(node.visibility ? { visibility: node.visibility } : {}),
        ...(node.css?.trim() ? { css: node.css } : {}),
      };
    });

  return { layout: tree.layout ?? null, sections: convert(tree.sections, "sections", base) };
}
