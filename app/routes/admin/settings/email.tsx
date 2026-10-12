import { z } from "zod";
import { requirePermission } from "~/.server/auth";
import { checkbox, formToObject, handleUserErrors, parse, UserError } from "~/.server/forms";
import { sendMail } from "~/.server/mail";
import { getSettings, setSettings } from "~/.server/settings";
import { TextField } from "~/admin/components/fields";
import { PageHeader } from "~/admin/components/page-header";
import { SettingsCard } from "~/admin/components/settings-form";
import { SettingsNav } from "~/admin/components/settings-nav";
import { SwitchField } from "~/admin/components/switch-field";
import { useActionToast } from "~/admin/feedback";
import { t } from "~/admin/i18n";
import type { Route } from "./+types/email";

export async function loader({ context }: Route.LoaderArgs) {
  const user = requirePermission(context, "settings");
  const { smtp } = await getSettings(["smtp"]);
  // La password non torna mai al browser.
  return { smtp: { ...smtp, pass: "" }, hasPassword: Boolean(smtp.pass), userEmail: user.email };
}

const schema = z.object({
  host: z.string().trim().max(255),
  port: z.coerce.number().int().min(1).max(65535),
  secure: checkbox,
  user: z.string().trim().max(255),
  pass: z.string().max(255),
  from: z.union([z.literal(""), z.email()]),
});

export async function action({ request, context }: Route.ActionArgs) {
  const user = requirePermission(context, "settings");
  const form = formToObject(await request.formData());
  return handleUserErrors(async () => {
    if (form.intent === "test") {
      try {
        await sendMail({ to: user.email, subject: t("email.testSubject"), text: t("email.testBody") });
      } catch (error) {
        throw new UserError(t("email.testFailed", { error: (error as Error).message }));
      }
      return { message: t("email.testSent", { email: user.email }) };
    }
    const input = parse(schema, form);
    const { smtp } = await getSettings(["smtp"]);
    await setSettings({ smtp: { ...input, pass: input.pass || smtp.pass } });
    return { message: t("common.saved") };
  });
}

export default function EmailSettings({ loaderData, actionData }: Route.ComponentProps) {
  useActionToast(actionData);
  const { smtp } = loaderData;
  const errors = actionData && "fieldErrors" in actionData ? (actionData.fieldErrors ?? {}) : {};
  return (
    <>
      <PageHeader title={t("settings.title")} />
      <SettingsNav />
      <div className="flex max-w-2xl flex-col gap-6">
        <SettingsCard title={t("settings.email")} description={t("email.description")} intent="save">
          <TextField name="host" label={t("email.host")} placeholder="smtp.esempio.it" defaultValue={smtp.host} error={errors.host} />
          <TextField name="port" type="number" label={t("email.port")} defaultValue={smtp.port} error={errors.port} />
          <SwitchField name="secure" label={t("email.secure")} description={t("email.secureHelp")} defaultChecked={smtp.secure} />
          <TextField name="user" label={t("email.user")} defaultValue={smtp.user} autoComplete="off" />
          <TextField
            name="pass"
            type="password"
            label={t("email.pass")}
            autoComplete="new-password"
            placeholder={loaderData.hasPassword ? "••••••••" : ""}
            description={loaderData.hasPassword ? t("email.passKeep") : undefined}
          />
          <TextField name="from" type="email" label={t("email.from")} defaultValue={smtp.from} error={errors.from} />
        </SettingsCard>
        <SettingsCard title={t("email.test")} description={t("email.testHelp", { email: loaderData.userEmail })} intent="test" submitLabel={t("email.sendTest")}>
          {null}
        </SettingsCard>
      </div>
    </>
  );
}
