import { requirePermission } from "~/.server/auth";
import { checkbox } from "~/.server/forms";
import { defaultLlms, defaultRobots } from "~/.server/seo-files";
import { getSettings, getSiteUrl, setSettings } from "~/.server/settings";
import { TextareaField } from "~/admin/components/fields";
import { PageHeader } from "~/admin/components/page-header";
import { SettingsCard } from "~/admin/components/settings-form";
import { SettingsNav } from "~/admin/components/settings-nav";
import { SwitchField } from "~/admin/components/switch-field";
import { useActionToast } from "~/admin/feedback";
import { t } from "~/admin/i18n";
import type { Route } from "./+types/seo";

export async function loader({ request, context }: Route.LoaderArgs) {
  requirePermission(context, "settings");
  const siteUrl = await getSiteUrl(request);
  const { robotsTxt, llmsTxt } = await getSettings(["robotsTxt", "llmsTxt"]);
  return {
    robots: { custom: robotsTxt !== null, value: robotsTxt ?? defaultRobots(siteUrl) },
    llms: { custom: llmsTxt !== null, value: llmsTxt ?? (await defaultLlms(siteUrl)) },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  requirePermission(context, "settings");
  const form = await request.formData();
  const intent = form.get("intent");
  const custom = checkbox.parse(form.get("custom") ?? undefined);
  const value = String(form.get("value") ?? "");
  if (intent === "robots") await setSettings({ robotsTxt: custom ? value : null });
  if (intent === "llms") await setSettings({ llmsTxt: custom ? value : null });
  return { message: t("common.saved") };
}

export default function SeoSettings({ loaderData, actionData }: Route.ComponentProps) {
  useActionToast(actionData);
  return (
    <>
      <PageHeader title={t("settings.title")} />
      <SettingsNav />
      <div className="grid gap-6 xl:grid-cols-2">
        {(["robots", "llms"] as const).map((kind) => (
          <SettingsCard
            key={kind}
            intent={kind}
            title={kind === "robots" ? "robots.txt" : "llms.txt"}
            description={
              <>
                {t(`seoFiles.${kind}Help`)}{" "}
                <a className="underline" href={kind === "robots" ? "/robots.txt" : "/llms.txt"} target="_blank" rel="noreferrer">
                  {t("common.view")}
                </a>
              </>
            }
          >
            <SwitchField name="custom" label={t("seoFiles.custom")} description={t("seoFiles.customHelp")} defaultChecked={loaderData[kind].custom} />
            <TextareaField
              key={String(loaderData[kind].custom)}
              name="value"
              label={t("seoFiles.content")}
              rows={14}
              className="font-mono text-xs"
              defaultValue={loaderData[kind].value}
            />
          </SettingsCard>
        ))}
      </div>
    </>
  );
}
