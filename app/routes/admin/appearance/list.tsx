import {
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  EyeIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useState } from "react";
import { Form, Link, redirect, useNavigation } from "react-router";
import { z } from "zod";
import { requirePermission } from "~/.server/auth";
import { formToObject, handleUserErrors, parse, UserError } from "~/.server/forms";
import { scaffoldTheme } from "~/.server/theme/scaffold";
import {
  activateTheme,
  createTheme,
  deleteTheme,
  duplicateTheme,
  importTheme,
  listThemes,
  publishTheme,
} from "~/.server/theme/store";
import { TextField } from "~/admin/components/fields";
import { PageHeader } from "~/admin/components/page-header";
import { useActionToast } from "~/admin/feedback";
import { t } from "~/admin/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import type { Route } from "./+types/list";

export async function loader({ context }: Route.LoaderArgs) {
  requirePermission(context, "themes");
  const themes = await listThemes();
  return {
    themes: themes.map((theme) => ({
      name: theme.name,
      label: theme.label,
      active: theme.active,
      published: theme.publishedBuildId !== null,
      unpublished: theme.draftBuildId !== null && theme.draftBuildId !== theme.publishedBuildId,
      buildError: theme.buildError,
      updatedAt: theme.updatedAt.toISOString(),
    })),
  };
}

const nameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, t("appearance.nameHelp"));

const actionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("create"),
    name: nameSchema,
    label: z.string().trim().min(1).max(255),
    from: z.string().optional(),
  }),
  z.object({ intent: z.literal("activate"), name: z.string() }),
  z.object({ intent: z.literal("publish"), name: z.string() }),
  z.object({ intent: z.literal("delete"), name: z.string() }),
]);

export async function action({ request, context }: Route.ActionArgs) {
  const user = requirePermission(context, "themes");
  return handleUserErrors(async () => {
    const form = await request.formData();
    if (form.get("intent") === "import") {
      const file = form.get("file");
      if (!(file instanceof File) || !file.size) throw new UserError(t("appearance.importDescription"));
      const name = String(form.get("name") ?? "").trim();
      const result = await importTheme(new Uint8Array(await file.arrayBuffer()), user.id, { name: name || undefined });
      throw redirect(`/admin/appearance/${result.name}`);
    }
    const input = parse(actionSchema, formToObject(form));
    switch (input.intent) {
      case "create":
        if (input.from) await duplicateTheme(input.from, input.name, input.label, user.id);
        else
          await createTheme(
            { name: input.name, label: input.label, sources: scaffoldTheme(input.name, input.label) },
            user.id,
          );
        throw redirect(`/admin/appearance/${input.name}`);
      case "activate":
        await activateTheme(input.name);
        return { message: t("appearance.activated") };
      case "publish":
        await publishTheme(input.name);
        return { message: t("appearance.publishedOk") };
      case "delete":
        await deleteTheme(input.name);
        return { message: t("appearance.deleted") };
    }
  });
}

type ThemeItem = Route.ComponentProps["loaderData"]["themes"][number];

export default function AppearanceList({ loaderData, actionData }: Route.ComponentProps) {
  useActionToast(actionData);
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const [dialog, setDialog] = useState<
    { type: "create"; from?: string } | { type: "import" } | { type: "delete"; theme: ThemeItem } | null
  >(null);
  const fromItems = [
    { value: "", label: t("appearance.fromScratch") },
    ...loaderData.themes.map((theme) => ({
      value: theme.name,
      label: t("appearance.duplicateOf", { label: theme.label }),
    })),
  ];

  return (
    <>
      <PageHeader
        title={t("nav.appearance")}
        description={t("appearance.description")}
        actions={
          <>
            <Button variant="outline" onClick={() => setDialog({ type: "import" })}>
              <UploadIcon data-icon="inline-start" />
              {t("appearance.import")}
            </Button>
            <Button onClick={() => setDialog({ type: "create" })}>
              <PlusIcon data-icon="inline-start" />
              {t("appearance.newTheme")}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {loaderData.themes.map((theme) => (
          <Card key={theme.name}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {theme.label}
                {theme.active && <Badge>{t("appearance.active")}</Badge>}
              </CardTitle>
              <CardDescription className="font-mono text-xs">{theme.name}</CardDescription>
              <CardAction>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon-sm" aria-label={t("common.actions")} />}
                  >
                    <EllipsisIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        render={<a href={`/?np_preview=${theme.name}`} target="_blank" rel="noreferrer" />}
                      >
                        <EyeIcon />
                        {t("appearance.preview")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setDialog({ type: "create", from: theme.name })}>
                        <CopyIcon />
                        {t("appearance.duplicate")}
                      </DropdownMenuItem>
                      <DropdownMenuItem render={<a href={`/admin/appearance/${theme.name}/api?export`} download />}>
                        <DownloadIcon />
                        {t("appearance.export")}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    {!theme.active && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => setDialog({ type: "delete", theme })}>
                          <Trash2Icon />
                          {t("common.delete")}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {theme.buildError ? (
                <Badge variant="destructive">{t("appearance.buildError")}</Badge>
              ) : theme.unpublished ? (
                <Badge variant="secondary">{t("appearance.unpublished")}</Badge>
              ) : (
                <Badge variant="outline">
                  {theme.published ? t("appearance.published") : t("appearance.neverPublished")}
                </Badge>
              )}
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              <Button size="sm" nativeButton={false} render={<Link to={`/admin/appearance/${theme.name}`} />}>
                <CodeIcon data-icon="inline-start" />
                {t("appearance.edit")}
              </Button>
              {theme.unpublished && !theme.buildError && (
                <Form method="post">
                  <input type="hidden" name="name" value={theme.name} />
                  <Button size="sm" variant="outline" name="intent" value="publish" disabled={busy}>
                    {t("appearance.publish")}
                  </Button>
                </Form>
              )}
              {!theme.active && theme.published && (
                <Form method="post">
                  <input type="hidden" name="name" value={theme.name} />
                  <Button size="sm" variant="outline" name="intent" value="activate" disabled={busy}>
                    {t("appearance.activate")}
                  </Button>
                </Form>
              )}
            </CardFooter>
          </Card>
        ))}
      </div>

      <Dialog open={dialog?.type === "create"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <Form method="post" className="contents">
            <DialogHeader>
              <DialogTitle>{t("appearance.createTitle")}</DialogTitle>
              <DialogDescription>{t("appearance.createDescription")}</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="from">{t("appearance.from")}</FieldLabel>
                <Select
                  name="from"
                  key={dialog?.type === "create" ? (dialog.from ?? "") : ""}
                  defaultValue={dialog?.type === "create" ? (dialog.from ?? "") : ""}
                  items={fromItems}
                >
                  <SelectTrigger id="from" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {fromItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <TextField name="label" label={t("appearance.label")} required />
              <TextField
                name="name"
                label={t("appearance.name")}
                description={t("appearance.nameHelp")}
                pattern="[a-z0-9][a-z0-9-]*"
                required
              />
            </FieldGroup>
            <DialogFooter>
              <Button type="submit" name="intent" value="create" disabled={busy}>
                {busy && <Spinner data-icon="inline-start" />}
                {t("appearance.create")}
              </Button>
            </DialogFooter>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.type === "import"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <Form method="post" encType="multipart/form-data" className="contents">
            <DialogHeader>
              <DialogTitle>{t("appearance.importTitle")}</DialogTitle>
              <DialogDescription>{t("appearance.importDescription")}</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="import-file">{t("appearance.importFile")}</FieldLabel>
                <Input id="import-file" type="file" name="file" accept=".zip,application/zip" required />
              </Field>
              <TextField
                name="name"
                label={t("appearance.importName")}
                description={t("appearance.importNameHelp")}
                pattern="[a-z0-9][a-z0-9-]*"
              />
            </FieldGroup>
            <DialogFooter>
              <Button type="submit" name="intent" value="import" disabled={busy}>
                {busy && <Spinner data-icon="inline-start" />}
                {t("appearance.import")}
              </Button>
            </DialogFooter>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={dialog?.type === "delete"} onOpenChange={(open) => !open && setDialog(null)}>
        <AlertDialogContent>
          {dialog?.type === "delete" && (
            <Form method="post" className="contents" onSubmit={() => setDialog(null)}>
              <input type="hidden" name="name" value={dialog.theme.name} />
              <AlertDialogHeader>
                <AlertDialogTitle>{t("appearance.deleteTitle", { label: dialog.theme.label })}</AlertDialogTitle>
                <AlertDialogDescription>{t("appearance.deleteDescription")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" render={<button type="submit" name="intent" value="delete" />}>
                  {t("common.delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </Form>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
