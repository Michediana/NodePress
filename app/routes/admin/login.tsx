import { Form, Link, redirect, useNavigation, useSearchParams } from "react-router";
import { createUserSession, getSessionUser, login, needsSetup } from "~/.server/auth";
import { AuthCard } from "~/admin/components/auth-card";
import { TextField } from "~/admin/components/fields";
import { t } from "~/admin/i18n";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { FieldGroup } from "~/components/ui/field";
import { Spinner } from "~/components/ui/spinner";
import type { Route } from "./+types/login";

export function meta() {
  return [{ title: t("login.title") }, { name: "robots", content: "noindex" }];
}

function safeNext(value: FormDataEntryValue | string | null) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/admin") && !next.startsWith("//") ? next : "/admin";
}

export async function loader({ request }: Route.LoaderArgs) {
  if (await needsSetup()) throw redirect("/admin/setup");
  if (await getSessionUser(request)) throw redirect("/admin");
  return { lang: "it" };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const user = await login(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
  if (!user) return { error: t("login.invalid") };
  return createUserSession(user.id, safeNext(form.get("next")));
}

export default function Login({ actionData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  return (
    <AuthCard title={t("login.title")} description={t("login.description")}>
      <Form method="post">
        <input type="hidden" name="next" value={params.get("next") ?? ""} />
        <FieldGroup>
          {params.get("reset") === "1" && (
            <Alert>
              <AlertDescription>{t("reset.done")}</AlertDescription>
            </Alert>
          )}
          {actionData?.error && (
            <Alert variant="destructive">
              <AlertDescription>{actionData.error}</AlertDescription>
            </Alert>
          )}
          <TextField name="email" type="email" label={t("users.email")} required autoComplete="email" autoFocus />
          <TextField name="password" type="password" label={t("users.password")} required autoComplete="current-password" />
          <Button type="submit" disabled={busy}>
            {busy && <Spinner data-icon="inline-start" />}
            {t("login.submit")}
          </Button>
          <Button variant="link" nativeButton={false} render={<Link to="/admin/forgot-password" />}>
            {t("login.forgot")}
          </Button>
        </FieldGroup>
      </Form>
    </AuthCard>
  );
}
