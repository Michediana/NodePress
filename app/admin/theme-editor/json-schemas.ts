import type { SectionSchema, SettingDef } from "~/lib/theme/sections";

// Schemi JSON per l'editor: validazione e autocompletamento di template, gruppi e theme.json,
// costruiti dalle sezioni del tema aperto.

type JsonSchema = Record<string, unknown>;

const bind: JsonSchema = {
  type: "object",
  description: 'Valore legato a un dato della pagina, es. { "bind": "page.translation.title" }.',
  properties: {
    bind: {
      type: "string",
      examples: ["page.translation.title", "page.translation.excerpt", "page.translation.ogImageId", "site.siteName"],
    },
    fallback: {},
  },
  required: ["bind"],
  additionalProperties: false,
};

const localized: JsonSchema = {
  type: "object",
  description: 'Testo tradotto per lingua, es. { "it": "Ciao", "en": "Hello" }.',
  patternProperties: { "^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$": { type: "string" } },
  additionalProperties: false,
};

function valueSchema(def: SettingDef): JsonSchema {
  const description = [def.label, def.help].filter(Boolean).join(" — ") || undefined;
  const withBind = (schema: JsonSchema) => ({ description, anyOf: [schema, bind] });
  switch (def.type) {
    case "text":
    case "textarea":
    case "link":
      return { description, anyOf: [{ type: "string" }, localized, bind] };
    case "color":
      return withBind({ type: "string" });
    case "number":
      return withBind({ type: "number", minimum: def.min, maximum: def.max });
    case "boolean":
      return withBind({ type: "boolean" });
    case "select":
      return withBind({ enum: def.options?.map((o) => o.value) ?? [] });
    case "media":
      return withBind({ type: "integer", description: "Id del media" });
    case "items":
      return {
        description,
        type: "object",
        properties: {
          collection: {
            type: ["integer", "string"],
            description: 'Id del raccoglitore o percorso nella lingua di default, es. "/novita".',
          },
          limit: { type: "integer", minimum: 1, maximum: 100 },
          offset: { type: "integer", minimum: 0 },
        },
        required: ["collection"],
        additionalProperties: false,
      };
  }
}

/** Schema di un albero di sezioni (template JSON o gruppo). */
function treeSchema(schemas: Record<string, SectionSchema>, components: string[]): JsonSchema {
  const definitions: Record<string, JsonSchema> = {};
  for (const schema of Object.values(schemas)) {
    const slots: Record<string, JsonSchema> = {};
    for (const [name, slot] of Object.entries(schema.slots)) {
      const accepts = slot.accepts?.length ? slot.accepts : Object.keys(schemas);
      slots[name] = {
        description: slot.label,
        type: "array",
        items: { anyOf: accepts.map((type) => ({ $ref: `#/definitions/${type}` })) },
      };
    }
    definitions[schema.name] = {
      type: "object",
      description: schema.description ?? schema.label,
      properties: {
        id: { type: "string", pattern: "^[\\w-]+$", description: "Id stabile della sezione (facoltativo)." },
        type: { const: schema.name, description: schema.label },
        settings: {
          type: "object",
          properties: Object.fromEntries(Object.entries(schema.settings).map(([key, def]) => [key, valueSchema(def)])),
          additionalProperties: false,
        },
        slots: { type: "object", properties: slots, additionalProperties: false },
        hidden: { type: "boolean" },
      },
      required: ["type"],
      additionalProperties: false,
    };
  }
  return {
    type: "object",
    definitions,
    properties: {
      layout: { description: "Componente che avvolge le sezioni.", anyOf: [{ enum: components }, { type: "null" }] },
      sections: {
        type: "array",
        items: { anyOf: Object.keys(schemas).map((type) => ({ $ref: `#/definitions/${type}` })) },
      },
    },
    required: ["sections"],
    additionalProperties: false,
  };
}

const manifestSchema: JsonSchema = {
  type: "object",
  properties: {
    name: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" },
    label: { type: "string" },
    version: { type: "string" },
    description: { type: "string" },
    author: { type: "string" },
    templates: {
      type: "object",
      description: "Template assegnabili ai nodi: templates/<nome>.np o .json.",
      additionalProperties: {
        type: "object",
        properties: {
          label: { type: "string" },
          kinds: { type: "array", items: { enum: ["page", "listing", "item"] }, minItems: 1 },
        },
        required: ["label", "kinds"],
      },
    },
    defaults: {
      type: "object",
      properties: { page: { type: "string" }, listing: { type: "string" }, item: { type: "string" } },
      additionalProperties: false,
    },
    tokens: {
      type: "object",
      description: "Token di design, disponibili nel CSS come var(--np-<nome>).",
      additionalProperties: {
        type: "object",
        properties: {
          type: { enum: ["color", "font", "size", "number", "text"] },
          label: { type: "string" },
          group: { type: "string" },
          default: { type: "string" },
        },
        required: ["type", "default"],
      },
    },
  },
  required: ["name", "label", "templates"],
};

export function themeJsonSchemas(schemas: Record<string, SectionSchema>, components: string[]) {
  return [
    { uri: "nodepress://schemas/theme.json", fileMatch: ["file:///theme.json"], schema: manifestSchema },
    {
      uri: "nodepress://schemas/tree.json",
      fileMatch: ["file:///templates/*.json", "file:///groups/*.json"],
      schema: treeSchema(schemas, components),
    },
  ];
}
