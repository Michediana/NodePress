import { SaveIcon } from "lucide-react";
import { Form, useNavigation } from "react-router";
import { t } from "~/admin/i18n";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { FieldGroup } from "~/components/ui/field";
import { Spinner } from "~/components/ui/spinner";

/** Card con form POST e pulsante di salvataggio, usata nelle pagine impostazioni. */
export function SettingsCard({
  title,
  description,
  children,
  intent,
  submitLabel,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  intent?: string;
  submitLabel?: string;
}) {
  const navigation = useNavigation();
  const busy = navigation.state === "submitting" && navigation.formData?.get("intent") === (intent ?? null);
  return (
    <Card>
      <Form method="post" className="flex flex-col gap-6">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>
          <FieldGroup>{children}</FieldGroup>
        </CardContent>
        <CardFooter>
          <Button type="submit" name="intent" value={intent} disabled={busy}>
            {busy ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
            {submitLabel ?? t("common.save")}
          </Button>
        </CardFooter>
      </Form>
    </Card>
  );
}
