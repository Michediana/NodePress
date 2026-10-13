import { FilterIcon, MoveRightIcon, PlusIcon, TimerIcon, TrashIcon } from "lucide-react";
import { Form, useSubmit } from "react-router";
import { z } from "zod";
import { requirePermission } from "~/.server/auth";
import { formToObject, handleUserErrors, parse, UserError } from "~/.server/forms";
import { createRedirect, deleteRedirect, listRedirects } from "~/.server/redirects";
import { TextField } from "~/admin/components/fields";
import { PageHeader } from "~/admin/components/page-header";
import { pageParam, Pager } from "~/admin/components/pager";
import { useActionToast } from "~/admin/feedback";
import { IconLabel } from "~/admin/components/icon-label";
import { confirmDialog } from "~/admin/components/dialogs";
import { t } from "~/admin/i18n";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import type { Route } from "./+types/redirects";

const PER_PAGE = 50;

export async function loader({ request, context }: Route.LoaderArgs) {
  requirePermission(context, "redirects");
  const page = pageParam(request);
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return { ...(await listRedirects({ page, perPage: PER_PAGE, q })), page, perPage: PER_PAGE, q };
}

const createSchema = z.object({
  fromPath: z.string().trim().min(1).max(700),
  toPath: z.string().trim().min(1).max(1000),
  statusCode: z.coerce.number().int(),
});

export async function action({ request, context }: Route.ActionArgs) {
  requirePermission(context, "redirects");
  const form = formToObject(await request.formData());
  return handleUserErrors(async () => {
    if (form.intent === "delete") {
      await deleteRedirect(Number(form.id));
      return { message: t("redirects.deleted") };
    }
    if (form.intent === "create") {
      await createRedirect(parse(createSchema, form));
      return { message: t("redirects.created") };
    }
    throw new UserError("Azione non valida.");
  });
}

// 301/308 permanenti, 302/307 temporanei
const statusCodes = ["301", "302", "307", "308"].map((code) => ({
  value: code,
  label: <IconLabel icon={code === "301" || code === "308" ? MoveRightIcon : TimerIcon}>{code}</IconLabel>,
}));

export default function Redirects({ loaderData, actionData }: Route.ComponentProps) {
  useActionToast(actionData);
  const submit = useSubmit();
  return (
    <>
      <PageHeader title={t("nav.redirects")} description={t("redirects.description")} />
      <Card>
        <CardHeader>
          <CardTitle>{t("redirects.new")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post">
            <FieldGroup className="grid items-end gap-4 md:grid-cols-[1fr_1fr_8rem_auto]">
              <TextField name="fromPath" label={t("redirects.from")} placeholder="/vecchia-pagina" required />
              <TextField name="toPath" label={t("redirects.to")} placeholder="/nuova-pagina" required />
              <Field>
                <FieldLabel htmlFor="statusCode">{t("redirects.code")}</FieldLabel>
                <Select name="statusCode" defaultValue="301" items={statusCodes}>
                  <SelectTrigger id="statusCode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {statusCodes.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Button type="submit" name="intent" value="create">
                <PlusIcon data-icon="inline-start" />
                {t("common.add")}
              </Button>
            </FieldGroup>
          </Form>
        </CardContent>
      </Card>
      <Form method="get" className="flex gap-2">
        <Input name="q" defaultValue={loaderData.q} placeholder={t("common.search")} className="max-w-xs" />
        <Button type="submit" variant="outline">
          <FilterIcon data-icon="inline-start" />
          {t("common.filter")}
        </Button>
      </Form>
      <Card className="py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{t("redirects.from")}</TableHead>
                <TableHead>{t("redirects.to")}</TableHead>
                <TableHead>{t("redirects.code")}</TableHead>
                <TableHead>{t("redirects.origin")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loaderData.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    {t("redirects.empty")}
                  </TableCell>
                </TableRow>
              )}
              {loaderData.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-4 font-mono text-xs">{r.fromPath}</TableCell>
                  <TableCell className="max-w-80 truncate font-mono text-xs">{r.toPath}</TableCell>
                  <TableCell>{r.statusCode}</TableCell>
                  <TableCell>
                    <Badge variant={r.automatic ? "secondary" : "outline"}>{r.automatic ? t("redirects.automatic") : t("redirects.manual")}</Badge>
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("common.delete")}
                      onClick={async () => {
                        if (await confirmDialog({ description: t("redirects.confirmDelete"), confirmLabel: t("common.delete"), destructive: true }))
                          submit({ intent: "delete", id: String(r.id) }, { method: "post" });
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
      <Pager page={loaderData.page} total={loaderData.total} perPage={loaderData.perPage} />
    </>
  );
}
