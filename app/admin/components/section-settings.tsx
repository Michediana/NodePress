import { ImageIcon, LinkIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { MediaPicker } from "~/admin/editor/media-picker";
import { t } from "~/admin/i18n";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { mediaUrl } from "~/lib/media";
import { isBind, isLocalized, type ItemsQuery, type SectionSchema, type SettingDef } from "~/lib/theme/sections";

export type CollectionOption = { id: number; label: string };

type Props = {
  schema: SectionSchema;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  collections: CollectionOption[];
  /** Anteprime dei media scelti (id → URL), solo per il pannello. */
  previews?: Record<string, string>;
  onPreviewsChange?: (previews: Record<string, string>) => void;
};

/** Form delle impostazioni di una sezione, generato dallo schema del tema. */
export function SectionSettingsForm({ schema, value, onChange, collections, previews = {}, onPreviewsChange }: Props) {
  const entries = Object.entries(schema.settings);
  if (!entries.length) return <p className="text-sm text-muted-foreground">{t("sectionSettings.empty")}</p>;
  const set = (key: string, next: unknown) => {
    const copy = { ...value };
    if (next === undefined) delete copy[key];
    else copy[key] = next;
    onChange(copy);
  };
  return (
    <FieldGroup className="gap-4">
      {entries.map(([key, def]) => (
        <SettingField
          key={key}
          id={`${schema.name}-${key}`}
          def={def}
          name={key}
          value={value[key]}
          onChange={(next) => set(key, next)}
          collections={collections}
          preview={previews[key]}
          onPreview={(src) => onPreviewsChange?.({ ...previews, [key]: src })}
        />
      ))}
    </FieldGroup>
  );
}

function SettingField({
  id,
  def,
  name,
  value,
  onChange,
  collections,
  preview,
  onPreview,
}: {
  id: string;
  def: SettingDef;
  name: string;
  value: unknown;
  onChange: (value: unknown) => void;
  collections: CollectionOption[];
  preview?: string;
  onPreview: (src: string) => void;
}) {
  const label = def.label ?? name;
  const current = value === undefined ? def.default : value;

  // Valori legati a un dato o tradotti: qui si mostrano, si modificano nel JSON del template.
  if (isBind(value)) {
    return (
      <Field>
        <FieldLabel>{label}</FieldLabel>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="font-mono">
            <LinkIcon />
            {t("sectionSettings.bound", { path: value.bind })}
          </Badge>
          <Button type="button" variant="ghost" size="xs" onClick={() => onChange(undefined)}>
            {t("sectionSettings.unbind")}
          </Button>
        </div>
      </Field>
    );
  }
  if (isLocalized(value)) {
    return (
      <Field>
        <FieldLabel>{label}</FieldLabel>
        <FieldDescription>{t("sectionSettings.translated")}</FieldDescription>
      </Field>
    );
  }

  const help = def.help && <FieldDescription>{def.help}</FieldDescription>;

  switch (def.type) {
    case "boolean":
      return (
        <Field orientation="horizontal">
          <Switch id={id} checked={Boolean(current)} onCheckedChange={(checked) => onChange(checked)} />
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          {help}
        </Field>
      );
    case "textarea":
      return (
        <Field>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Textarea
            id={id}
            rows={3}
            value={String(current ?? "")}
            placeholder={def.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
          {help}
        </Field>
      );
    case "number":
      return (
        <Field>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input
            id={id}
            type="number"
            min={def.min}
            max={def.max}
            value={current === null || current === undefined ? "" : String(current)}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          />
          {help}
        </Field>
      );
    case "select": {
      const items = def.options ?? [];
      return (
        <Field>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Select value={String(current ?? "")} onValueChange={(next) => onChange(next)} items={items}>
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {items.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {help}
        </Field>
      );
    }
    case "color":
      return (
        <Field>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={label}
              value={/^#[0-9a-f]{6}$/i.test(String(current)) ? String(current) : "#000000"}
              onChange={(e) => onChange(e.target.value)}
              className="size-8 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
            />
            <Input
              id={id}
              value={String(current ?? "")}
              onChange={(e) => onChange(e.target.value || undefined)}
              className="font-mono"
            />
          </div>
          {help}
        </Field>
      );
    case "media":
      return (
        <MediaField
          id={id}
          label={label}
          value={typeof current === "number" ? current : null}
          preview={preview}
          onChange={onChange}
          onPreview={onPreview}
        />
      );
    case "items": {
      const query = (current && typeof current === "object" ? current : {}) as Partial<ItemsQuery>;
      const items = collections.map((c) => ({ value: String(c.id), label: c.label }));
      // Un percorso (es. "/novita") scritto nel JSON resta valido finché non si sceglie un raccoglitore.
      const selected = typeof query.collection === "number" ? String(query.collection) : "";
      return (
        <Field>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <Select
              value={selected}
              onValueChange={(next) => onChange({ ...query, collection: Number(next), limit: query.limit ?? 3 })}
              items={items}
            >
              <SelectTrigger id={id} className="w-full" aria-label={t("sectionSettings.collection")}>
                <SelectValue
                  placeholder={
                    typeof query.collection === "string" ? query.collection : t("sectionSettings.noCollection")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {items.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Input
              type="number"
              min={1}
              max={100}
              aria-label={t("sectionSettings.limit")}
              value={String(query.limit ?? 3)}
              onChange={(e) => onChange({ ...query, limit: Math.min(Math.max(Number(e.target.value) || 1, 1), 100) })}
            />
          </div>
          {help}
        </Field>
      );
    }
    default:
      // text, link
      return (
        <Field>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input
            id={id}
            value={String(current ?? "")}
            placeholder={def.placeholder ?? (def.type === "link" ? "/percorso o https://…" : undefined)}
            onChange={(e) => onChange(e.target.value)}
          />
          {help}
        </Field>
      );
  }
}

function MediaField({
  id,
  label,
  value,
  preview,
  onChange,
  onPreview,
}: {
  id: string;
  label: string;
  value: number | null;
  preview?: string;
  onChange: (value: unknown) => void;
  onPreview: (src: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {value && preview ? (
            <img src={preview} alt="" className="size-full object-cover" />
          ) : (
            <ImageIcon className="size-4 text-muted-foreground" />
          )}
        </div>
        <Button id={id} type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          {t("sectionSettings.chooseMedia")}
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onChange(undefined)}
            aria-label={t("sectionSettings.removeMedia")}
          >
            <XIcon />
          </Button>
        )}
      </div>
      <MediaPicker
        open={open}
        onOpenChange={setOpen}
        onSelect={([media]) => {
          if (!media) return;
          onChange(media.id);
          onPreview(mediaUrl(media.file));
        }}
      />
    </Field>
  );
}
