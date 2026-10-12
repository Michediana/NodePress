import { eq } from "drizzle-orm";
import { z } from "zod";
import { getUser, hashPassword, verifyPassword } from "~/.server/auth";
import { db, schema } from "~/.server/db";
import { formToObject, handleUserErrors, parse, UserError } from "~/.server/forms";
import { TextField } from "~/admin/components/fields";
import { PageHeader } from "~/admin/components/page-header";
import { SettingsCard } from "~/admin/components/settings-form";
import { useActionToast } from "~/admin/feedback";
import { t } from "~/admin/i18n";
import type { Route } from "./+types/profile";

export async function loader({ context }: Route.LoaderArgs) {
  return { user: getUser(context) };
}

const profileSchema = z.object({ name: z.string().trim().min(1).max(255), email: z.email().trim().toLowerCase() });
const passwordSchema = z.object({ current: z.string(), password: z.string().min(8).max(200), confirm: z.string() });

export async function action({ request, context }: Route.ActionArgs) {
  const user = getUser(context);
  const form = formToObject(await request.formData());
  return handleUserErrors(async () => {
    if (form.intent === "password") {
      const input = parse(passwordSchema, form);
      if (input.password !== input.confirm) throw new UserError(t("reset.mismatch"));
      const [row] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
      if (!(await verifyPassword(input.current, row.passwordHash))) throw new UserError(t("profile.wrongPassword"));
      await db.update(schema.users).set({ passwordHash: await hashPassword(input.password) }).where(eq(schema.users.id, user.id));
      return { message: t("profile.passwordChanged") };
    }
    const input = parse(profileSchema, form);
    const [taken] = await db.select().from(schema.users).where(eq(schema.users.email, input.email));
    if (taken && taken.id !== user.id) throw new UserError(t("users.emailTaken"));
    await db.update(schema.users).set(input).where(eq(schema.users.id, user.id));
    return { message: t("common.saved") };
  });
}

export default function Profile({ loaderData, actionData }: Route.ComponentProps) {
  useActionToast(actionData);
  const { user } = loaderData;
  return (
    <>
      <PageHeader title={t("nav.profile")} />
      <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
        <SettingsCard title={t("profile.data")} intent="profile">
          <TextField name="name" label={t("users.name")} defaultValue={user.name} required />
          <TextField name="email" type="email" label={t("users.email")} defaultValue={user.email} required />
        </SettingsCard>
        <SettingsCard title={t("profile.changePassword")} intent="password">
          <TextField name="current" type="password" label={t("profile.currentPassword")} autoComplete="current-password" required />
          <TextField name="password" type="password" label={t("users.newPassword")} autoComplete="new-password" minLength={8} required />
          <TextField name="confirm" type="password" label={t("users.confirmPassword")} autoComplete="new-password" minLength={8} required />
        </SettingsCard>
      </div>
    </>
  );
}
