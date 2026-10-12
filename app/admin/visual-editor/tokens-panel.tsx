import { RotateCcwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "~/admin/i18n";
import { Button } from "~/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import type { ThemeToken } from "~/lib/theme/manifest";

/** Colore CSS qualsiasi (oklch, rgb, nomi…) in #rrggbb, per il selettore nativo. Solo nel browser. */
function toHex(color: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Font proposti: stack di sistema, nessun servizio esterno (privacy, prestazioni). */
const FONT_STACKS = [
  { label: "Sistema (sans-serif)", value: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif' },
  {
    label: "Umanista",
    value: 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", source-sans-pro, sans-serif',
  },
  { label: "Geometrico", value: 'Avenir, Montserrat, Corbel, "URW Gothic", source-sans-pro, sans-serif' },
  { label: "Neo-grottesco", value: 'Inter, Roboto, "Helvetica Neue", "Arial Nova", "Nimbus Sans", Arial, sans-serif' },
  { label: "Serif di transizione", value: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, serif' },
  { label: "Serif antico", value: '"Iowan Old Style", "Palatino Linotype", "URW Palladio L", P052, serif' },
  { label: "Didone", value: 'Didot, "Bodoni MT", "Noto Serif Display", "URW Palladio L", P052, Sylfaen, serif' },
  { label: "Slab serif", value: 'Rockwell, "Rockwell Nova", "Roboto Slab", "DejaVu Serif", "Sitka Small", serif' },
  {
    label: "Monospazio",
    value: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, "DejaVu Sans Mono", monospace',
  },
];

type Props = {
  tokens: Record<string, ThemeToken>;
  values: Record<string, string>;
  onChange: (name: string, value: string | undefined) => void;
};

/** Token del tema raggruppati: colori, tipografia, layout… Le modifiche si vedono subito nell'anteprima. */
export function TokensPanel({ tokens, values, onChange }: Props) {
  const groups = new Map<string, [string, ThemeToken][]>();
  for (const entry of Object.entries(tokens)) {
    const group = entry[1].group ?? t("visual.tokensOther");
    groups.set(group, [...(groups.get(group) ?? []), entry]);
  }
  if (!groups.size) return <p className="p-4 text-sm text-muted-foreground">{t("visual.noTokens")}</p>;
  return (
    <div className="flex flex-col gap-6 p-4">
      {[...groups].map(([group, entries]) => (
        <FieldSet key={group}>
          <FieldLegend variant="label">{group}</FieldLegend>
          <FieldGroup className="gap-4">
            {entries.map(([name, token]) => (
              <TokenField
                key={name}
                name={name}
                token={token}
                value={values[name]}
                onChange={(value) => onChange(name, value)}
              />
            ))}
          </FieldGroup>
        </FieldSet>
      ))}
    </div>
  );
}

function TokenField({
  name,
  token,
  value,
  onChange,
}: {
  name: string;
  token: ThemeToken;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const current = value ?? token.default;
  const id = `token-${name}`;
  const reset =
    value !== undefined ? (
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => onChange(undefined)}
        aria-label={t("visual.resetToken")}
        title={t("visual.resetToken")}
      >
        <RotateCcwIcon />
      </Button>
    ) : null;
  const label = (
    <div className="flex items-center justify-between gap-2">
      <FieldLabel htmlFor={id}>{token.label ?? name}</FieldLabel>
      {reset}
    </div>
  );

  if (token.type === "color")
    return <ColorToken id={id} label={label} name={token.label ?? name} value={current} onChange={onChange} />;

  if (token.type === "font") {
    const items = FONT_STACKS.some((f) => f.value === current)
      ? FONT_STACKS
      : [{ label: t("visual.fontCustom"), value: current }, ...FONT_STACKS];
    return (
      <Field>
        {label}
        <Select value={current} onValueChange={(next) => onChange(String(next))} items={items}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {items.map((font) => (
                <SelectItem key={font.value} value={font.value}>
                  <span style={{ fontFamily: font.value }}>{font.label}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Input
          value={current}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-xs"
          aria-label={t("visual.fontStack")}
        />
      </Field>
    );
  }

  return (
    <Field>
      {label}
      <Input
        id={id}
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className={token.type === "text" ? undefined : "font-mono text-xs"}
      />
    </Field>
  );
}

function ColorToken({
  id,
  label,
  name,
  value,
  onChange,
}: {
  id: string;
  label: React.ReactNode;
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  // Il selettore nativo vuole #rrggbb: la conversione da oklch & co. si fa nel browser, dopo il montaggio.
  const [hex, setHex] = useState("#000000");
  useEffect(() => setHex(toHex(value) ?? "#000000"), [value]);
  return (
    <Field>
      {label}
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={name}
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          className="size-8 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
        />
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs" />
      </div>
    </Field>
  );
}
