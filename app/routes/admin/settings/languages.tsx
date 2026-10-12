import { PlusIcon, StarIcon, TrashIcon } from "lucide-react";
import { Form, useNavigation } from "react-router";
import { requirePermission } from "~/.server/auth";
import { handleUserErrors, UserError } from "~/.server/forms";
import { addLanguage, getLanguages, removeLanguage, setDefaultLanguage } from "~/.server/languages";
import { LanguageSelect } from "~/admin/components/language-select";
import { PageHeader } from "~/admin/components/page-header";
import { SettingsNav } from "~/admin/components/settings-nav";
import { useActionToast } from "~/admin/feedback";
import { t } from "~/admin/i18n";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { languageName, languageOptions, nativeLanguageName, normalizeLangCode } from "~/lib/languages";
import type { Route } from "./+types/languages";

export async function loader({ context }: Route.LoaderArgs) {
  requirePermission(context, "languages");
  return { languages: await getLanguages(), languageOptions: languageOptions() };
}

export async function action({ request, context }: Route.ActionArgs) {
  requirePermission(context, "languages");
  const form = await request.formData();
  const intent = form.get("intent");
  return handleUserErrors(async () => {
    if (intent === "add") {
      const base = String(form.get("base") ?? "");
      const region = String(form.get("region") ?? "").trim();
      const code = normalizeLangCode(region ? `${base}-${region}` : base);
      if (!code) throw new UserError(t("languages.invalid"));
      await addLanguage(code);
      return { message: t("languages.added", { name: languageName(code) }) };
    }
    const code = String(form.get("code") ?? "");
    if (intent === "remove") {
      await removeLanguage(code).catch((e: Error) => {
        throw new UserError(e.message);
      });
      return { message: t("languages.removed") };
    }
    if (intent === "default") {
      await setDefaultLanguage(code);
      return { message: t("languages.defaultSet", { name: languageName(code) }) };
    }
    throw new UserError("Azione non valida.");
  });
}

export default function LanguagesSettings({ loaderData, actionData }: Route.ComponentProps) {
  useActionToast(actionData);
  const navigation = useNavigation();
  const { languages } = loaderData;
  return (
    <>
      <PageHeader title={t("settings.title")} description={t("languages.description")} />
      <SettingsNav />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t("languages.active")}</CardTitle>
            <CardDescription>{t("languages.activeHelp")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("languages.language")}</TableHead>
                  <TableHead>{t("languages.code")}</TableHead>
                  <TableHead>{t("languages.prefix")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {languages.map((lang) => (
                  <TableRow key={lang.code}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{languageName(lang.code)}</span>
                        <span className="text-muted-foreground">{nativeLanguageName(lang.code)}</span>
                        {lang.isDefault && <Badge>{t("languages.default")}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <code>{lang.code}</code>
                    </TableCell>
                    <TableCell>
                      <code>{lang.isDefault ? "/" : `/${lang.code}/`}</code>
                    </TableCell>
                    <TableCell>
                      {!lang.isDefault && (
                        <div className="flex justify-end gap-2">
                          <Form method="post">
                            <input type="hidden" name="code" value={lang.code} />
                            <Button type="submit" name="intent" value="default" variant="outline" size="sm">
                              <StarIcon data-icon="inline-start" />
                              {t("languages.makeDefault")}
                            </Button>
                          </Form>
                          <Form
                            method="post"
                            onSubmit={(e) => {
                              if (!confirm(t("languages.confirmRemove"))) e.preventDefault();
                            }}
                          >
                            <input type="hidden" name="code" value={lang.code} />
                            <Button type="submit" name="intent" value="remove" variant="destructive" size="sm">
                              <TrashIcon data-icon="inline-start" />
                              {t("common.deactivate")}
                            </Button>
                          </Form>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t("languages.add")}</CardTitle>
            <CardDescription>{t("languages.addHelp")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="base">{t("languages.language")}</FieldLabel>
                  <LanguageSelect options={loaderData.languageOptions} id="base" name="base" className="w-full" defaultValue={languages.some((l) => l.code === "en") ? undefined : "en"} exclude={languages.filter((l) => !l.code.includes("-")).map((l) => l.code)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="region">{t("languages.region")}</FieldLabel>
                  <Input id="region" name="region" placeholder="BR" maxLength={3} />
                  <FieldDescription>{t("languages.regionHelp")}</FieldDescription>
                </Field>
                <Button type="submit" name="intent" value="add" disabled={navigation.state !== "idle"}>
                  <PlusIcon data-icon="inline-start" />
                  {t("languages.activate")}
                </Button>
              </FieldGroup>
            </Form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
