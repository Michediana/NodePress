import { CopyIcon, EyeIcon, KeyRoundIcon, PaletteIcon, ShieldIcon, TrashIcon } from "lucide-react";
import { Form, useSubmit } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { getApiDocsContext } from "~/.server/api-docs";
import { createApiKey, deleteApiKey, listApiKeys } from "~/.server/api-keys";
import { deleteGrant, listGrants } from "~/.server/oauth";
import { requirePermission } from "~/.server/auth";
import { formToObject, handleUserErrors, parse, UserError } from "~/.server/forms";
import { ApiDocs } from "~/admin/components/api-docs";
import { ConnectedApps } from "~/admin/components/connected-apps";
import { McpSetup } from "~/admin/components/mcp-setup";
import { TextField } from "~/admin/components/fields";
import { PageHeader } from "~/admin/components/page-header";
import { useActionToast } from "~/admin/feedback";
import { IconLabel } from "~/admin/components/icon-label";
import { confirmDialog } from "~/admin/components/dialogs";
import { t } from "~/admin/i18n";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "~/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import type { Route } from "./+types/api-keys";

export async function loader({ request, context }: Route.LoaderArgs) {
  requirePermission(context, "apikeys");
  const [keys, docs, apps] = await Promise.all([listApiKeys(), getApiDocsContext(request), listGrants()]);
  return { keys, docs, apps, mcpUrl: `${new URL(request.url).origin}/mcp` };
}

const createSchema = z.object({ name: z.string().trim().min(1).max(255), scope: z.enum(["read", "theme", "admin"]) });

export async function action({ request, context }: Route.ActionArgs) {
  const user = requirePermission(context, "apikeys");
  const form = formToObject(await request.formData());
  return handleUserErrors(async () => {
    if (form.intent === "revokeGrant") {
      if (!(await deleteGrant(Number(form.id)))) throw new UserError(t("apiKeys.notFound"), 404);
      return { message: t("oauth.revoked") };
    }
    if (form.intent === "delete") {
      await deleteApiKey(Number(form.id));
      return { message: t("apiKeys.revoked") };
    }
    if (form.intent === "create") {
      const input = parse(createSchema, form);
      return { key: await createApiKey(input.name, input.scope, user.id) };
    }
    throw new UserError("Azione non valida.");
  });
}

const scopes = [
  { value: "read", label: <IconLabel icon={EyeIcon}>read</IconLabel> },
  { value: "theme", label: <IconLabel icon={PaletteIcon}>theme</IconLabel> },
  { value: "admin", label: <IconLabel icon={ShieldIcon}>admin</IconLabel> },
];

export default function ApiKeys({ loaderData, actionData }: Route.ComponentProps) {
  useActionToast(actionData);
  const submit = useSubmit();
  const newKey = actionData && "key" in actionData ? actionData.key : null;
  return (
    <>
      <PageHeader title={t("nav.apiKeys")} description={t("apiKeys.description")} />
      {newKey && (
        <Alert>
          <KeyRoundIcon />
          <AlertTitle>{t("apiKeys.createdTitle")}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            {t("apiKeys.createdHelp")}
            <InputGroup>
              <InputGroupInput readOnly value={newKey} className="font-mono text-xs" />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  aria-label={t("common.copy")}
                  onClick={() => navigator.clipboard.writeText(newKey).then(() => toast.success(t("common.copied")))}
                >
                  <CopyIcon />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">{t("apiKeys.name")}</TableHead>
                  <TableHead>{t("apiKeys.key")}</TableHead>
                  <TableHead>{t("apiKeys.scope")}</TableHead>
                  <TableHead>{t("apiKeys.lastUsed")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loaderData.keys.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      {t("apiKeys.empty")}
                    </TableCell>
                  </TableRow>
                )}
                {loaderData.keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="pl-4">
                      <div className="font-medium">{key.name}</div>
                      <div className="text-xs text-muted-foreground">{key.createdBy ?? "—"}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">np_{key.prefix}_…</TableCell>
                    <TableCell>
                      <Badge variant={key.scope === "admin" ? "default" : "secondary"}>{key.scope}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString("it") : t("apiKeys.never")}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("apiKeys.revoke")}
                        onClick={async () => {
                          if (await confirmDialog({ description: t("apiKeys.confirmRevoke"), confirmLabel: t("apiKeys.revoke"), destructive: true }))
                            submit({ intent: "delete", id: String(key.id) }, { method: "post" });
                        }}
                      >
                        <TrashIcon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t("apiKeys.new")}</CardTitle>
            <CardDescription>{t("apiKeys.usage")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post">
              <FieldGroup>
                <TextField name="name" label={t("apiKeys.name")} required />
                <Field>
                  <FieldLabel htmlFor="scope">{t("apiKeys.scope")}</FieldLabel>
                  <Select name="scope" defaultValue="read" items={scopes}>
                    <SelectTrigger id="scope" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {scopes.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>{t("apiKeys.scopeHelp")}</FieldDescription>
                </Field>
                <Button type="submit" name="intent" value="create">
                  <KeyRoundIcon data-icon="inline-start" />
                  {t("apiKeys.create")}
                </Button>
              </FieldGroup>
            </Form>
          </CardContent>
        </Card>
      </div>
      <McpSetup url={loaderData.mcpUrl} apiKey={newKey} />
      <ConnectedApps apps={loaderData.apps} showUser />
      <ApiDocs context={loaderData.docs} initialKey={newKey} />
    </>
  );
}
