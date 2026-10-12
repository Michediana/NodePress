import { z } from "zod";
import { requirePermission } from "~/.server/auth";
import { formToObject, handleUserErrors, parse } from "~/.server/forms";
import { getSettings, setSettings } from "~/.server/settings";
import { TextField } from "~/admin/components/fields";
import { PageHeader } from "~/admin/components/page-header";
import { SettingsCard } from "~/admin/components/settings-form";
import { SettingsNav } from "~/admin/components/settings-nav";
import { useActionToast } from "~/admin/feedback";
import { t } from "~/admin/i18n";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import type { Route } from "./+types/media";

export async function loader({ context }: Route.LoaderArgs) {
  requirePermission(context, "settings");
  return getSettings(["mediaFormat", "mediaQuality", "mediaMaxSize"]);
}

const schema = z.object({
  mediaFormat: z.enum(["webp", "avif"]),
  mediaQuality: z.coerce.number().int().min(1).max(100),
  mediaMaxSize: z.coerce.number().int().min(320).max(10000),
});

export async function action({ request, context }: Route.ActionArgs) {
  requirePermission(context, "settings");
  return handleUserErrors(async () => {
    await setSettings(parse(schema, formToObject(await request.formData())));
    return { message: t("common.saved") };
  });
}

export default function MediaSettings({ loaderData, actionData }: Route.ComponentProps) {
  useActionToast(actionData);
  const errors = actionData && "fieldErrors" in actionData ? (actionData.fieldErrors ?? {}) : {};
  return (
    <>
      <PageHeader title={t("settings.title")} />
      <SettingsNav />
      <div className="max-w-2xl">
        <SettingsCard title={t("settings.media")} description={t("mediaSettings.description")}>
          <Field>
            <FieldLabel htmlFor="mediaFormat">{t("mediaSettings.format")}</FieldLabel>
            <Select name="mediaFormat" defaultValue={loaderData.mediaFormat} items={{ webp: "WEBP", avif: "AVIF" }}>
              <SelectTrigger id="mediaFormat">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="webp">WEBP</SelectItem>
                  <SelectItem value="avif">AVIF</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>{t("mediaSettings.formatHelp")}</FieldDescription>
          </Field>
          <TextField name="mediaQuality" type="number" min={1} max={100} label={t("mediaSettings.quality")} defaultValue={loaderData.mediaQuality} error={errors.mediaQuality} />
          <TextField
            name="mediaMaxSize"
            type="number"
            min={320}
            max={10000}
            label={t("mediaSettings.maxSize")}
            description={t("mediaSettings.maxSizeHelp")}
            defaultValue={loaderData.mediaMaxSize}
            error={errors.mediaMaxSize}
          />
        </SettingsCard>
      </div>
    </>
  );
}
