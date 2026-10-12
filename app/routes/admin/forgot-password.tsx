import { eq } from "drizzle-orm";
import { Form, Link, useNavigation } from "react-router";
import { createPasswordReset } from "~/.server/auth";
import { db, schema } from "~/.server/db";
import { isMailConfigured, sendMail } from "~/.server/mail";
import { getSiteUrl } from "~/.server/settings";
import { AuthCard } from "~/admin/components/auth-card";
import { TextField } from "~/admin/components/fields";
import { t } from "~/admin/i18n";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { FieldGroup } from "~/components/ui/field";
import { Spinner } from "~/components/ui/spinner";
import type { Route } from "./+types/forgot-password";

export function meta() {
  return [{ title: t("forgot.title") }, { name: "robots", content: "noindex" }];
}

export async function loader() {
  return { lang: "it", mailConfigured: await isMailConfigured() };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (user) {
    const token = await createPasswordReset(user.id);
    const url = `${await getSiteUrl(request)}/admin/reset-password/${token}`;
    try {
      await sendMail({
        to: user.email,
        subject: t("forgot.mailSubject"),
        text: t("forgot.mailBody", { name: user.name, url }),
      });
    } catch (error) {
      console.error("Invio email di reset fallito:", error);
      return { error: t("forgot.mailError") };
    }
  }
  // Stessa risposta che l'utente esista o meno.
  return { sent: true };
}

export default function ForgotPassword({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  return (
    <AuthCard title={t("forgot.title")} description={t("forgot.description")}>
      <Form method="post">
        <FieldGroup>
          {!loaderData.mailConfigured && (
            <Alert variant="destructive">
              <AlertDescription>{t("forgot.notConfigured")}</AlertDescription>
            </Alert>
          )}
          {actionData && "sent" in actionData && (
            <Alert>
              <AlertDescription>{t("forgot.sent")}</AlertDescription>
            </Alert>
          )}
          {actionData && "error" in actionData && (
            <Alert variant="destructive">
              <AlertDescription>{actionData.error}</AlertDescription>
            </Alert>
          )}
          <TextField name="email" type="email" label={t("users.email")} required autoComplete="email" />
          <Button type="submit" disabled={busy || !loaderData.mailConfigured}>
            {busy && <Spinner data-icon="inline-start" />}
            {t("forgot.submit")}
          </Button>
          <Button variant="link" nativeButton={false} render={<Link to="/admin/login" />}>
            {t("forgot.back")}
          </Button>
        </FieldGroup>
      </Form>
    </AuthCard>
  );
}
