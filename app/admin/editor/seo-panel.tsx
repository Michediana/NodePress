import { CircleCheckIcon, CircleDotIcon, CircleXIcon, ImageIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { t } from "~/admin/i18n";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import type { ContentDoc } from "~/lib/content";
import { altFor, mediaUrl, type MediaRef } from "~/lib/media";
import { analyzeSeo, type SeoCheckResult } from "~/lib/seo-score";
import { cn } from "~/lib/utils";
import { MediaPicker } from "./media-picker";

export type SeoState = {
  seoTitle: string;
  seoDescription: string;
  focusKeyword: string;
  ogImageId: number | null;
  noindex: boolean;
};

const icons: Record<SeoCheckResult, React.ComponentType<{ className?: string }>> = {
  good: CircleCheckIcon,
  ok: CircleDotIcon,
  bad: CircleXIcon,
};

const tone: Record<SeoCheckResult, string> = {
  good: "text-primary",
  ok: "text-muted-foreground",
  bad: "text-destructive",
};

function Counter({ value, min, max }: { value: number; min: number; max: number }) {
  return (
    <span className={cn("text-xs tabular-nums", value >= min && value <= max ? "text-muted-foreground" : "text-destructive")}>
      {value}/{max}
    </span>
  );
}

export function SeoPanel({
  value,
  onChange,
  title,
  slug,
  doc,
  url,
  media,
  lang,
}: {
  value: SeoState;
  onChange: (value: SeoState) => void;
  title: string;
  slug: string;
  doc: ContentDoc | null;
  url: string;
  media: MediaRef[];
  lang: string;
}) {
  const [picker, setPicker] = useState(false);
  const [extraMedia, setExtraMedia] = useState<MediaRef[]>([]);
  const allMedia = [...media, ...extraMedia];
  const ogImage = allMedia.find((m) => m.id === value.ogImageId) ?? null;
  const set = (patch: Partial<SeoState>) => onChange({ ...value, ...patch });

  const analysis = useMemo(
    () =>
      analyzeSeo({
        title,
        slug,
        content: doc,
        seoTitle: value.seoTitle,
        seoDescription: value.seoDescription,
        focusKeyword: value.focusKeyword,
        mediaAlt: Object.fromEntries(allMedia.map((m) => [m.id, altFor(m, lang)])),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title, slug, doc, value, media, extraMedia, lang],
  );

  const effectiveTitle = value.seoTitle || title;

  return (
    <Card>
      <input type="hidden" name="seoTitle" value={value.seoTitle} />
      <input type="hidden" name="seoDescription" value={value.seoDescription} />
      <input type="hidden" name="focusKeyword" value={value.focusKeyword} />
      <input type="hidden" name="ogImageId" value={value.ogImageId ?? ""} />
      <input type="hidden" name="noindex" value={value.noindex ? "on" : ""} />
      <CardHeader>
        <CardTitle>{t("seo.title")}</CardTitle>
        <CardAction>
          <Badge variant={analysis.rating === "good" ? "default" : analysis.rating === "ok" ? "secondary" : "destructive"}>
            {t("seo.score", { score: analysis.score })}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <div className="flex flex-col gap-0.5 rounded-lg border p-3">
            <span className="truncate text-xs text-muted-foreground">{url}</span>
            <span className="line-clamp-1 text-base text-primary">{effectiveTitle || t("content.untitled")}</span>
            <span className="line-clamp-2 text-xs text-muted-foreground">{value.seoDescription || t("seo.noDescription")}</span>
          </div>
          <Field>
            <FieldLabel htmlFor="focusKeyword">{t("seo.focusKeyword")}</FieldLabel>
            <Input id="focusKeyword" value={value.focusKeyword} onChange={(e) => set({ focusKeyword: e.target.value })} />
          </Field>
          <Field>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="seoTitle">{t("seo.seoTitle")}</FieldLabel>
              <Counter value={effectiveTitle.length} min={30} max={60} />
            </div>
            <Input id="seoTitle" placeholder={title} value={value.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} />
          </Field>
          <Field>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="seoDescription">{t("seo.description")}</FieldLabel>
              <Counter value={value.seoDescription.length} min={120} max={160} />
            </div>
            <Textarea id="seoDescription" rows={3} value={value.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel>{t("seo.ogImage")}</FieldLabel>
            {ogImage ? (
              <div className="relative">
                <img src={mediaUrl(ogImage.variants[0]?.file ?? ogImage.file)} alt="" className="aspect-[1.91/1] w-full rounded-md object-cover" />
                <Button type="button" variant="secondary" size="icon-xs" className="absolute top-1 right-1" onClick={() => set({ ogImageId: null })} aria-label={t("common.remove")}>
                  <XIcon />
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" onClick={() => setPicker(true)}>
                <ImageIcon data-icon="inline-start" />
                {t("seo.chooseOgImage")}
              </Button>
            )}
            <FieldDescription>{t("seo.ogImageHelp")}</FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <Switch id="noindex" checked={value.noindex} onCheckedChange={(checked) => set({ noindex: checked })} />
            <FieldContent>
              <FieldLabel htmlFor="noindex">{t("seo.noindex")}</FieldLabel>
              <FieldDescription>{t("seo.noindexHelp")}</FieldDescription>
            </FieldContent>
          </Field>
          <ul className="flex flex-col gap-2 text-sm">
            {analysis.checks.map((check) => {
              const Icon = icons[check.result];
              return (
                <li key={check.id} className="flex gap-2">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", tone[check.result])} />
                  <span>{t(`seo.checks.${check.id}.${check.result}`, check.params)}</span>
                </li>
              );
            })}
          </ul>
        </FieldGroup>
      </CardContent>
      <MediaPicker
        open={picker}
        onOpenChange={setPicker}
        onSelect={([m]) => {
          if (!m) return;
          setExtraMedia((list) => [...list, m]);
          set({ ogImageId: m.id });
        }}
      />
    </Card>
  );
}
