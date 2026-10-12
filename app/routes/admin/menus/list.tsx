import { PlusIcon } from "lucide-react";
import { Form, Link, redirect } from "react-router";
import { z } from "zod";
import { requirePermission } from "~/.server/auth";
import { formToObject, handleUserErrors, parse } from "~/.server/forms";
import { createMenu, listMenus } from "~/.server/menus";
import { TextField } from "~/admin/components/fields";
import { PageHeader } from "~/admin/components/page-header";
import { useActionToast } from "~/admin/feedback";
import { t } from "~/admin/i18n";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { FieldGroup } from "~/components/ui/field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import type { Route } from "./+types/list";

export async function loader({ context }: Route.LoaderArgs) {
  requirePermission(context, "menus");
  return { menus: await listMenus() };
}

const createSchema = z.object({ name: z.string().trim().min(1).max(255), location: z.string().max(64).optional() });

export async function action({ request, context }: Route.ActionArgs) {
  requirePermission(context, "menus");
  return handleUserErrors(async () => {
    const input = parse(createSchema, formToObject(await request.formData()));
    const id = await createMenu(input.name, input.location);
    throw redirect(`/admin/menus/${id}`);
  });
}

export default function MenuList({ loaderData, actionData }: Route.ComponentProps) {
  useActionToast(actionData);
  return (
    <>
      <PageHeader title={t("nav.menus")} description={t("menus.description")} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardContent>
            {loaderData.menus.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t("menus.empty")}</EmptyTitle>
                  <EmptyDescription>{t("menus.emptyDescription")}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("menus.name")}</TableHead>
                    <TableHead>{t("menus.location")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loaderData.menus.map((menu) => (
                    <TableRow key={menu.id}>
                      <TableCell>
                        <Link to={`/admin/menus/${menu.id}`} className="font-medium hover:underline">
                          {menu.name}
                        </Link>
                      </TableCell>
                      <TableCell>{menu.location ? <Badge variant="secondary">{menu.location}</Badge> : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t("menus.new")}</CardTitle>
            <CardDescription>{t("menus.locationHelp")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post">
              <FieldGroup>
                <TextField name="name" label={t("menus.name")} required />
                <TextField name="location" label={t("menus.location")} placeholder="header" />
                <Button type="submit">
                  <PlusIcon data-icon="inline-start" />
                  {t("menus.create")}
                </Button>
              </FieldGroup>
            </Form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
