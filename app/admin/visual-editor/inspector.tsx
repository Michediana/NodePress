import { CopyIcon, MonitorIcon, SmartphoneIcon, TabletIcon, Trash2Icon } from "lucide-react";
import { SectionSettingsForm, type CollectionOption } from "~/admin/components/section-settings";
import { t } from "~/admin/i18n";
import { MiniCode } from "~/admin/theme-editor/mini-code";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Separator } from "~/components/ui/separator";
import { languageName } from "~/lib/languages";
import {
  isResponsive,
  type Device,
  type ResponsiveValue,
  type SectionSchema,
  type Visibility,
} from "~/lib/theme/sections";
import type { Viewport } from "./canvas";
import type { RawNode } from "./model";

/** Il breakpoint che si modifica dipende dalla viewport dell'anteprima (mobile first). */
const BREAKPOINT_OF: Record<Viewport, "base" | "tablet" | "desktop"> = {
  mobile: "base",
  tablet: "tablet",
  desktop: "desktop",
  full: "desktop",
};

const DEVICES: { value: Device; icon: typeof MonitorIcon }[] = [
  { value: "mobile", icon: SmartphoneIcon },
  { value: "tablet", icon: TabletIcon },
  { value: "desktop", icon: MonitorIcon },
];

/** Valore mostrato per un breakpoint: il suo, o quello del breakpoint più piccolo che lo eredita. */
function valueAt(value: ResponsiveValue, bp: "base" | "tablet" | "desktop") {
  if (bp === "desktop") return value.desktop ?? value.tablet ?? value.base;
  if (bp === "tablet") return value.tablet ?? value.base;
  return value.base;
}

type Props = {
  node: RawNode;
  schema: SectionSchema | undefined;
  viewport: Viewport;
  languages: string[];
  collections: CollectionOption[];
  onChange: (fn: (node: RawNode) => void, key: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
};

export function Inspector({ node, schema, viewport, languages, collections, onChange, onDuplicate, onRemove }: Props) {
  const bp = BREAKPOINT_OF[viewport];

  if (!schema) return <p className="p-4 text-sm text-destructive">{t("visual.missingSection")}</p>;

  // Le impostazioni responsive si mostrano con il valore del breakpoint corrente.
  const view: Record<string, unknown> = { ...node.settings };
  for (const [key, def] of Object.entries(schema.settings)) {
    if (!def.responsive) continue;
    const raw = node.settings[key] ?? def.default;
    view[key] = isResponsive(raw) ? valueAt(raw, bp) : raw;
  }
  const responsiveKeys = Object.entries(schema.settings)
    .filter(([, def]) => def.responsive)
    .map(([key]) => key);
  const labelled: SectionSchema = {
    ...schema,
    settings: Object.fromEntries(
      Object.entries(schema.settings).map(([key, def]) => [
        key,
        def.responsive ? { ...def, label: `${def.label ?? key} · ${t(`visual.bp.${bp}`)}` } : def,
      ]),
    ),
  };

  const setSettings = (next: Record<string, unknown>) =>
    onChange((target) => {
      for (const [key, def] of Object.entries(schema.settings)) {
        if (!def.responsive) continue;
        if (next[key] === view[key]) {
          next[key] = target.settings[key];
          continue;
        }
        // Modifica di un valore responsive: si salva solo per il breakpoint corrente.
        const current = target.settings[key] ?? def.default;
        const values: ResponsiveValue = isResponsive(current) ? { ...current } : { base: current };
        values[bp] = next[key];
        const keys = Object.keys(values).filter((k) => values[k as keyof ResponsiveValue] !== undefined);
        next[key] = keys.length === 1 && keys[0] === "base" ? values.base : values;
      }
      target.settings = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
    }, `settings:${node.id}`);

  const setVisibility = (patch: Partial<Visibility>) =>
    onChange((target) => {
      target.visibility = { ...target.visibility, ...patch };
    }, `visibility:${node.id}`);

  const hideOn = node.visibility?.hideOn ?? [];
  const langs = node.visibility?.langs ?? [];

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-medium">{schema.label}</span>
          <span className="font-mono text-xs text-muted-foreground">#{node.id}</span>
        </div>
        <div className="flex">
          <Button variant="ghost" size="icon-sm" onClick={onDuplicate} aria-label={t("visual.duplicate")}>
            <CopyIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={t("common.delete")}>
            <Trash2Icon />
          </Button>
        </div>
      </div>
      {schema.description && <p className="-mt-3 text-xs text-muted-foreground">{schema.description}</p>}

      {responsiveKeys.length > 0 && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{t(`visual.bp.${bp}`)}</Badge>
          {t("visual.responsiveHelp")}
        </p>
      )}

      <SectionSettingsForm schema={labelled} value={view} onChange={setSettings} collections={collections} />

      <Separator />

      <FieldSet>
        <FieldLegend variant="label">{t("visual.visibility")}</FieldLegend>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel>{t("visual.hideOn")}</FieldLabel>
            <div className="flex gap-3">
              {DEVICES.map(({ value, icon: Icon }) => (
                <label key={value} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={hideOn.includes(value)}
                    onCheckedChange={(checked) =>
                      setVisibility({ hideOn: checked ? [...hideOn, value] : hideOn.filter((d) => d !== value) })
                    }
                  />
                  <Icon className="size-3.5 text-muted-foreground" />
                  {t(`visual.device.${value}`)}
                </label>
              ))}
            </div>
          </Field>
          {languages.length > 1 && (
            <Field>
              <FieldLabel>{t("visual.onlyLangs")}</FieldLabel>
              <div className="flex flex-wrap gap-3">
                {languages.map((code) => (
                  <label key={code} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={langs.includes(code)}
                      onCheckedChange={(checked) =>
                        setVisibility({ langs: checked ? [...langs, code] : langs.filter((l) => l !== code) })
                      }
                    />
                    {languageName(code)}
                  </label>
                ))}
              </div>
              <FieldDescription>{t("visual.onlyLangsHelp")}</FieldDescription>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field>
              <FieldLabel htmlFor="vis-from">{t("visual.from")}</FieldLabel>
              <Input
                id="vis-from"
                type="datetime-local"
                value={node.visibility?.from?.slice(0, 16) ?? ""}
                onChange={(e) => setVisibility({ from: e.target.value || undefined })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="vis-until">{t("visual.until")}</FieldLabel>
              <Input
                id="vis-until"
                type="datetime-local"
                value={node.visibility?.until?.slice(0, 16) ?? ""}
                onChange={(e) => setVisibility({ until: e.target.value || undefined })}
              />
            </Field>
          </div>
        </FieldGroup>
      </FieldSet>

      <Separator />

      <Field>
        <FieldLabel>{t("visual.instanceCss")}</FieldLabel>
        <FieldDescription>{t("visual.instanceCssHelp")}</FieldDescription>
        <MiniCode
          key={node.id}
          value={node.css ?? ""}
          onChange={(css) => onChange((target) => void (target.css = css), `css:${node.id}`)}
          height={160}
          ariaLabel={t("visual.instanceCss")}
        />
      </Field>
    </div>
  );
}
