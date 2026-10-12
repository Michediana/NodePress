import { Form, redirect, useNavigation } from "react-router";
import { z } from "zod";
import { createUserSession, hashPassword, needsSetup } from "~/.server/auth";
import { db, schema } from "~/.server/db";
import { formToObject, handleUserErrors, parse, UserError } from "~/.server/forms";
import { addLanguage } from "~/.server/languages";
import { setSettings } from "~/.server/settings";
import { AuthCard } from "~/admin/components/auth-card";
import { TextField } from "~/admin/components/fields";
import { LanguageSelect } from "~/admin/components/language-select";
import { t } from "~/admin/i18n";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from "~/components/ui/field";
import { Spinner } from "~/components/ui/spinner";
import { languageOptions, normalizeLangCode } from "~/lib/languages";
import type { Route } from "./+types/setup";

export function meta() {
  return [{ title: t("setup.title") }, { name: "robots", content: "noindex" }];
}

export async function loader() {
  if (!(await needsSetup())) throw redirect("/admin");
  return { lang: "it", languageOptions: languageOptions() };
}

const setupSchema = z.object({
  siteName: z.string().trim().min(1).max(255),
  defaultLang: z.string().transform((v, ctx) => {
    const code = normalizeLangCode(v);
    if (!code) ctx.addIssue({ code: "custom", message: t("languages.invalid") });
    return code ?? "";
  }),
  name: z.string().trim().min(1).max(255),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8).max(200),
});

export async function action({ request }: Route.ActionArgs) {
  return handleUserErrors(async () => {
    if (!(await needsSetup())) throw new UserError(t("setup.alreadyDone"));
    const input = parse(setupSchema, formToObject(await request.formData()));
    await addLanguage(input.defaultLang);
    await setSettings({ siteName: input.siteName });
    const [result] = await db.insert(schema.users).values({
      email: input.email,
      name: input.name,
      role: "admin",
      passwordHash: await hashPassword(input.password),
    });
    return createUserSession(result.insertId, "/admin");
  });
}

export default function Setup({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const errors = actionData?.fieldErrors ?? {};
  const busy = navigation.state !== "idle";
  return (
    <AuthCard title={t("setup.title")} description={t("setup.description")} wide>
      <Form method="post">
        <FieldGroup>
          {actionData?.error && (
            <Alert variant="destructive">
              <AlertDescription>{actionData.error}</AlertDescription>
            </Alert>
          )}
          <TextField name="siteName" label={t("setup.siteName")} required error={errors.siteName} />
          <Field>
            <FieldLabel htmlFor="defaultLang">{t("setup.defaultLang")}</FieldLabel>
            <LanguageSelect options={loaderData.languageOptions} id="defaultLang" name="defaultLang" defaultValue="it" className="w-full" />
            <FieldDescription>{t("setup.defaultLangHelp")}</FieldDescription>
          </Field>
          <FieldSeparator>{t("setup.adminAccount")}</FieldSeparator>
          <TextField name="name" label={t("users.name")} required autoComplete="name" error={errors.name} />
          <TextField name="email" type="email" label={t("users.email")} required autoComplete="email" error={errors.email} />
          <TextField
            name="password"
            type="password"
            label={t("users.password")}
            required
            minLength={8}
            autoComplete="new-password"
            description={t("users.passwordHelp")}
            error={errors.password}
          />
          <Button type="submit" disabled={busy}>
            {busy && <Spinner data-icon="inline-start" />}
            {t("setup.submit")}
          </Button>
        </FieldGroup>
      </Form>
    </AuthCard>
  );
}
