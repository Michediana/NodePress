import { z } from "zod";
import { requirePermission } from "~/.server/auth";
import { checkbox, formToObject, handleUserErrors, parse } from "~/.server/forms";
import { getSettings, setSettings } from "~/.server/settings";
import { TextField } from "~/admin/components/fields";
import { PageHeader } from "~/admin/components/page-header";
import { SettingsCard } from "~/admin/components/settings-form";
import { SettingsNav } from "~/admin/components/settings-nav";
import { SwitchField } from "~/admin/components/switch-field";
import { useActionToast } from "~/admin/feedback";
import { t } from "~/admin/i18n";
import type { Route } from "./+types/general";

export async function loader({ context }: Route.LoaderArgs) {
  requirePermission(context, "settings");
  return getSettings(["siteName", "siteUrl", "publicApi"]);
}

const schema = z.object({
  siteName: z.string().trim().min(1).max(255),
  siteUrl: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]),
  publicApi: checkbox,
});

export async function action({ request, context }: Route.ActionArgs) {
  requirePermission(context, "settings");
  return handleUserErrors(async () => {
    const input = parse(schema, formToObject(await request.formData()));
    await setSettings({ ...input, siteUrl: input.siteUrl.replace(/\/+$/, "") });
    return { message: t("common.saved") };
  });
}

export default function GeneralSettings({ loaderData, actionData }: Route.ComponentProps) {
  useActionToast(actionData);
  const errors = actionData && "fieldErrors" in actionData ? (actionData.fieldErrors ?? {}) : {};
  return (
    <>
      <PageHeader title={t("settings.title")} />
      <SettingsNav />
      <div className="max-w-2xl">
        <SettingsCard title={t("settings.general")}>
          <TextField name="siteName" label={t("settings.siteName")} defaultValue={loaderData.siteName} required error={errors.siteName} />
          <TextField
            name="siteUrl"
            type="url"
            label={t("settings.siteUrl")}
            placeholder="https://www.esempio.it"
            defaultValue={loaderData.siteUrl}
            description={t("settings.siteUrlHelp")}
            error={errors.siteUrl}
          />
          <SwitchField name="publicApi" label={t("settings.publicApi")} description={t("settings.publicApiHelp")} defaultChecked={loaderData.publicApi} />
        </SettingsCard>
      </div>
    </>
  );
}
