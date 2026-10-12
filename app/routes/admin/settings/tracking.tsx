import { z } from "zod";
import { requirePermission } from "~/.server/auth";
import { formToObject, handleUserErrors, parse } from "~/.server/forms";
import { getSiteLanguages } from "~/.server/languages";
import { getSettings, setSettings } from "~/.server/settings";
import { TextareaField, TextField } from "~/admin/components/fields";
import { PageHeader } from "~/admin/components/page-header";
import { SettingsCard } from "~/admin/components/settings-form";
import { SettingsNav } from "~/admin/components/settings-nav";
import { useActionToast } from "~/admin/feedback";
import { t } from "~/admin/i18n";
import { FieldSeparator } from "~/components/ui/field";
import { consentTextsFor } from "~/lib/consent";
import { languageName } from "~/lib/languages";
import type { Route } from "./+types/tracking";

export async function loader({ context }: Route.LoaderArgs) {
  requirePermission(context, "settings");
  const settings = await getSettings(["ga4Id", "gtmId", "clarityId", "consentTexts"]);
  const { codes } = await getSiteLanguages();
  return {
    ...settings,
    langs: codes.map((code) => ({ code, custom: settings.consentTexts[code] ?? null, defaults: consentTextsFor(code) })),
  };
}

const idsSchema = z.object({
  ga4Id: z.union([z.literal(""), z.string().trim().regex(/^G-[A-Z0-9]+$/, "Formato atteso: G-XXXXXXX")]),
  gtmId: z.union([z.literal(""), z.string().trim().regex(/^GTM-[A-Z0-9]+$/, "Formato atteso: GTM-XXXXXXX")]),
  clarityId: z.union([z.literal(""), z.string().trim().regex(/^[a-z0-9]+$/i, "ID Clarity non valido")]),
});

export async function action({ request, context }: Route.ActionArgs) {
  requirePermission(context, "settings");
  const form = formToObject(await request.formData());
  return handleUserErrors(async () => {
    if (form.intent === "texts") {
      const { codes } = await getSiteLanguages();
      const consentTexts: Record<string, { title: string; text: string; accept: string; reject: string }> = {};
      for (const code of codes) {
        const get = (field: string) => String(form[`${code}.${field}`] ?? "").trim();
        consentTexts[code] = { title: get("title"), text: get("text"), accept: get("accept"), reject: get("reject") };
      }
      await setSettings({ consentTexts });
    } else {
      await setSettings(parse(idsSchema, form));
    }
    return { message: t("common.saved") };
  });
}

export default function TrackingSettings({ loaderData, actionData }: Route.ComponentProps) {
  useActionToast(actionData);
  const errors = actionData && "fieldErrors" in actionData ? (actionData.fieldErrors ?? {}) : {};
  return (
    <>
      <PageHeader title={t("settings.title")} />
      <SettingsNav />
      <div className="grid gap-6 xl:grid-cols-2">
        <SettingsCard title={t("tracking.title")} description={t("tracking.description")} intent="ids">
          <TextField name="ga4Id" label="Google Analytics 4" placeholder="G-XXXXXXXXXX" defaultValue={loaderData.ga4Id} error={errors.ga4Id} />
          <TextField name="gtmId" label="Google Tag Manager" placeholder="GTM-XXXXXXX" defaultValue={loaderData.gtmId} error={errors.gtmId} />
          <TextField name="clarityId" label="Microsoft Clarity" placeholder="abcdefghij" defaultValue={loaderData.clarityId} error={errors.clarityId} />
        </SettingsCard>
        <SettingsCard title={t("tracking.banner")} description={t("tracking.bannerHelp")} intent="texts">
          {loaderData.langs.map(({ code, custom, defaults }) => (
            <div key={code} className="flex flex-col gap-4">
              <FieldSeparator>{languageName(code)}</FieldSeparator>
              <TextField name={`${code}.title`} label={t("tracking.bannerTitle")} placeholder={defaults.title} defaultValue={custom?.title ?? ""} />
              <TextareaField name={`${code}.text`} label={t("tracking.bannerText")} placeholder={defaults.text} defaultValue={custom?.text ?? ""} rows={3} />
              <div className="grid grid-cols-2 gap-4">
                <TextField name={`${code}.accept`} label={t("tracking.accept")} placeholder={defaults.accept} defaultValue={custom?.accept ?? ""} />
                <TextField name={`${code}.reject`} label={t("tracking.reject")} placeholder={defaults.reject} defaultValue={custom?.reject ?? ""} />
              </div>
            </div>
          ))}
        </SettingsCard>
      </div>
    </>
  );
}
