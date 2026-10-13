import { z } from "zod";
import { requirePermission } from "~/.server/auth";
import { env } from "~/.server/env";
import { checkbox, formToObject, handleUserErrors, parse, UserError } from "~/.server/forms";
import { getSettings, setSettings } from "~/.server/settings";
import { TextField } from "~/admin/components/fields";
import { PageHeader } from "~/admin/components/page-header";
import { SettingsCard } from "~/admin/components/settings-form";
import { SettingsNav } from "~/admin/components/settings-nav";
import { SwitchField } from "~/admin/components/switch-field";
import { useActionToast } from "~/admin/feedback";
import { t } from "~/admin/i18n";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { CSP_MODES } from "~/lib/csp";
import type { Route } from "./+types/general";

export async function loader({ context }: Route.LoaderArgs) {
  requirePermission(context, "settings");
  return { ...(await getSettings(["siteName", "siteUrl", "publicApi", "cspMode"])), adminUrl: env.adminUrl };
}

const schema = z.object({
  siteName: z.string().trim().min(1).max(255),
  siteUrl: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]),
  publicApi: checkbox,
});

const securitySchema = z.object({ cspMode: z.enum(CSP_MODES) });

export async function action({ request, context }: Route.ActionArgs) {
  requirePermission(context, "settings");
  return handleUserErrors(async () => {
    const form = formToObject(await request.formData());
    if (form.intent === "security") {
      await setSettings(parse(securitySchema, form));
      return { message: t("common.saved") };
    }
    const input = parse(schema, form);
    // Con il pannello su un'origine separata serve sapere dove sta il sito, per i redirect e le anteprime.
    if (env.adminUrl && !input.siteUrl)
      throw new UserError(t("settings.siteUrlRequired"), 400, { siteUrl: t("settings.siteUrlRequired") });
    await setSettings({ ...input, siteUrl: input.siteUrl.replace(/\/+$/, "") });
    return { message: t("common.saved") };
  });
}

const cspItems = CSP_MODES.map((mode) => ({ value: mode, label: t(`settings.cspModes.${mode}`) }));

export default function GeneralSettings({ loaderData, actionData }: Route.ComponentProps) {
  useActionToast(actionData);
  const errors = actionData && "fieldErrors" in actionData ? (actionData.fieldErrors ?? {}) : {};
  return (
    <>
      <PageHeader title={t("settings.title")} />
      <SettingsNav />
      <div className="flex max-w-2xl flex-col gap-6">
        <SettingsCard title={t("settings.general")}>
          <TextField
            name="siteName"
            label={t("settings.siteName")}
            defaultValue={loaderData.siteName}
            required
            error={errors.siteName}
          />
          <TextField
            name="siteUrl"
            type="url"
            label={t("settings.siteUrl")}
            placeholder="https://www.esempio.it"
            defaultValue={loaderData.siteUrl}
            description={t("settings.siteUrlHelp")}
            error={errors.siteUrl}
          />
          <SwitchField
            name="publicApi"
            label={t("settings.publicApi")}
            description={t("settings.publicApiHelp")}
            defaultChecked={loaderData.publicApi}
          />
        </SettingsCard>
        <SettingsCard title={t("settings.security")} intent="security">
          <Field>
            <FieldLabel htmlFor="cspMode">{t("settings.csp")}</FieldLabel>
            <Select name="cspMode" defaultValue={loaderData.cspMode} items={cspItems}>
              <SelectTrigger id="cspMode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {cspItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>{t("settings.cspHelp")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>{t("settings.adminOrigin")}</FieldLabel>
            <FieldDescription>
              {loaderData.adminUrl ? (
                <>
                  {t("settings.adminOriginOn")} <code>{loaderData.adminUrl}</code>
                </>
              ) : (
                t("settings.adminOriginOff")
              )}
            </FieldDescription>
          </Field>
        </SettingsCard>
      </div>
    </>
  );
}
