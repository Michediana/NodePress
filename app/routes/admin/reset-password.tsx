import { Form, redirect, useNavigation } from "react-router";
import { consumePasswordReset, findPasswordReset } from "~/.server/auth";
import { AuthCard } from "~/admin/components/auth-card";
import { TextField } from "~/admin/components/fields";
import { t } from "~/admin/i18n";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { FieldGroup } from "~/components/ui/field";
import { Spinner } from "~/components/ui/spinner";
import type { Route } from "./+types/reset-password";

export function meta() {
  return [{ title: t("reset.title") }, { name: "robots", content: "noindex" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  return { lang: "it", valid: Boolean(await findPasswordReset(params.token)) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  if (password.length < 8) return { error: t("users.passwordHelp") };
  if (password !== form.get("confirm")) return { error: t("reset.mismatch") };
  if (!(await consumePasswordReset(params.token, password))) return { error: t("reset.invalid") };
  throw redirect("/admin/login?reset=1");
}

export default function ResetPassword({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  if (!loaderData.valid) {
    return (
      <AuthCard title={t("reset.title")}>
        <Alert variant="destructive">
          <AlertDescription>{t("reset.invalid")}</AlertDescription>
        </Alert>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t("reset.title")} description={t("reset.description")}>
      <Form method="post">
        <FieldGroup>
          {actionData?.error && (
            <Alert variant="destructive">
              <AlertDescription>{actionData.error}</AlertDescription>
            </Alert>
          )}
          <TextField name="password" type="password" label={t("users.newPassword")} required minLength={8} autoComplete="new-password" />
          <TextField name="confirm" type="password" label={t("users.confirmPassword")} required minLength={8} autoComplete="new-password" />
          <Button type="submit" disabled={busy}>
            {busy && <Spinner data-icon="inline-start" />}
            {t("reset.submit")}
          </Button>
        </FieldGroup>
      </Form>
    </AuthCard>
  );
}
