import { ArrowLeftIcon, ShieldIcon, TrashIcon, UserIcon, UserPenIcon } from "lucide-react";
import { Form, Link, redirect, useNavigation, useSubmit } from "react-router";
import { requirePermission } from "~/.server/auth";
import { formToObject, handleUserErrors, parse } from "~/.server/forms";
import { createUser, deleteUser, getUserById, updateUser, userInputSchema } from "~/.server/users";
import { TextField } from "~/admin/components/fields";
import { PageHeader } from "~/admin/components/page-header";
import { useActionToast, type ActionResult } from "~/admin/feedback";
import { IconLabel } from "~/admin/components/icon-label";
import { t } from "~/admin/i18n";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardFooter } from "~/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { roles } from "~/lib/roles";
import type { Route } from "./+types/edit";

export async function loader({ params, context }: Route.LoaderArgs) {
  const me = requirePermission(context, "users");
  if (params.id === "new") return { user: null, isSelf: false };
  const user = await getUserById(Number(params.id));
  if (!user) throw new Response("Utente non trovato", { status: 404 });
  return { user, isSelf: user.id === me.id };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const me = requirePermission(context, "users");
  const form = formToObject(await request.formData());
  return handleUserErrors(async () => {
    if (form.intent === "delete") {
      await deleteUser(Number(params.id), me.id);
      throw redirect("/admin/users");
    }
    const input = parse(userInputSchema, form);
    if (params.id === "new") {
      const id = await createUser(input);
      throw redirect(`/admin/users/${id}`);
    }
    await updateUser(Number(params.id), input);
    return { message: t("common.saved") };
  });
}

export default function EditUser({ loaderData, actionData: rawActionData }: Route.ComponentProps) {
  const actionData = rawActionData as ActionResult | undefined;
  useActionToast(actionData);
  const { user, isSelf } = loaderData;
  const roleIcons = { admin: ShieldIcon, editor: UserPenIcon, author: UserIcon };
  const roleItems = roles.map((role) => ({ value: role, label: <IconLabel icon={roleIcons[role]}>{t(`roles.${role}`)}</IconLabel> }));
  const navigation = useNavigation();
  const submit = useSubmit();
  const errors = actionData?.fieldErrors ?? {};
  return (
    <>
      <PageHeader
        title={user ? user.name : t("users.new")}
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link to="/admin/users" />}>
              <ArrowLeftIcon data-icon="inline-start" />
              {t("common.back")}
            </Button>
            {user && !isSelf && (
              <Button variant="destructive" onClick={() => confirm(t("users.confirmDelete")) && submit({ intent: "delete" }, { method: "post" })}>
                <TrashIcon data-icon="inline-start" />
                {t("common.delete")}
              </Button>
            )}
          </>
        }
      />
      <Card className="max-w-xl">
        <Form method="post" className="flex flex-col gap-6">
          <CardContent>
            <FieldGroup>
              <TextField name="name" label={t("users.name")} defaultValue={user?.name} required error={errors.name} />
              <TextField name="email" type="email" label={t("users.email")} defaultValue={user?.email} required error={errors.email} />
              <Field>
                <FieldLabel htmlFor="role">{t("users.role")}</FieldLabel>
                <Select name="role" defaultValue={user?.role ?? "author"} items={roleItems}>
                  <SelectTrigger id="role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {roleItems.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>{t("users.roleHelp")}</FieldDescription>
              </Field>
              <TextField
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required={!user}
                label={user ? t("users.newPassword") : t("users.password")}
                description={user ? t("users.passwordKeep") : t("users.passwordHelp")}
                error={errors.password}
              />
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button type="submit" name="intent" value="save" disabled={navigation.state !== "idle"}>
              {navigation.state !== "idle" && <Spinner data-icon="inline-start" />}
              {user ? t("common.save") : t("users.create")}
            </Button>
          </CardFooter>
        </Form>
      </Card>
    </>
  );
}
