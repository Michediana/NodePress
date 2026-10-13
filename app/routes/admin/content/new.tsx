import { eq } from "drizzle-orm";
import { ListTreeIcon, PlusIcon } from "lucide-react";
import { Form, redirect, useNavigation, useSearchParams } from "react-router";
import { useState } from "react";
import { z } from "zod";
import { getUser } from "~/.server/auth";
import { db, schema } from "~/.server/db";
import { formToObject, handleUserErrors, parse } from "~/.server/forms";
import { getSiteLanguages } from "~/.server/languages";
import { createNode, deleteNode, getTreeOptions, saveTranslation } from "~/.server/nodes";
import { TextField } from "~/admin/components/fields";
import { PageHeader } from "~/admin/components/page-header";
import { SlugInput, useAutoSlug } from "~/admin/components/slug-input";
import { IconLabel } from "~/admin/components/icon-label";
import { nodeIcon } from "~/admin/components/node-icon";
import { t } from "~/admin/i18n";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardFooter } from "~/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { languageName, langPrefix } from "~/lib/languages";
import { getTemplateOptions } from "~/.server/theme";
import { kindOfNode, templatesOfKind, type TemplateKind } from "~/lib/theme/manifest";
import type { Route } from "./+types/new";

export async function loader({ request, context }: Route.LoaderArgs) {
  getUser(context);
  const url = new URL(request.url);
  const type = (url.searchParams.get("type") ?? "page") as "page" | "collection" | "item";
  const parentId = Number(url.searchParams.get("parent")) || null;
  const langs = await getSiteLanguages();
  let collection = null;
  if (type === "item") {
    if (!parentId) throw new Response("Raccoglitore mancante", { status: 400 });
    collection = await db.query.nodes.findFirst({
      where: eq(schema.nodes.id, parentId),
      with: { translations: { columns: { lang: true, title: true, path: true } } },
    });
    if (collection?.type !== "collection") throw new Response("Raccoglitore non trovato", { status: 404 });
  }
  const options = (await getTreeOptions(langs.defaultLang)).filter((o) => o.type === "page");
  const { templates, defaults } = await getTemplateOptions();
  return { type, parentId, langs, options, collection, templates, templateDefaults: defaults };
}

const schemaInput = z.object({
  type: z.enum(["page", "collection", "item"]),
  parentId: z.coerce.number().int().optional().transform((v) => v || null),
  template: z.string().optional().default(""),
  itemTemplate: z.string().optional(),
  perPage: z.coerce.number().int().min(1).max(100).optional(),
  title: z.string().trim().min(1).max(255),
  slug: z.string().trim().max(191),
});

export async function action({ request, context }: Route.ActionArgs) {
  const user = getUser(context);
  return handleUserErrors(async () => {
    const input = parse(schemaInput, formToObject(await request.formData()));
    const [{ defaultLang }, { defaults }] = await Promise.all([getSiteLanguages(), getTemplateOptions()]);
    const id = await createNode(user.id, {
      parentId: input.parentId,
      type: input.type,
      template: input.template || defaults[kindOfNode(input.type)],
      itemTemplate: input.itemTemplate,
      perPage: input.perPage,
    });
    try {
      await saveTranslation(id, defaultLang, { title: input.title, slug: input.slug, status: "draft" });
    } catch (error) {
      await deleteNode(id);
      throw error;
    }
    throw redirect(`/admin/content/${id}?lang=${defaultLang}`);
  });
}

export default function NewContent({ loaderData, actionData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const [type, setType] = useState(loaderData.type);
  const [parentId, setParentId] = useState(String(loaderData.parentId ?? ""));
  const slug = useAutoSlug("", "", true);
  const { langs, options, collection } = loaderData;
  const templateKinds = (kind: TemplateKind) => templatesOfKind(loaderData.templates, kind);
  const defaultTemplate = loaderData.templateDefaults;
  const parentItems = [
    { value: "", depth: 0, label: <IconLabel icon={ListTreeIcon}>{t("content.root")}</IconLabel> },
    ...options.map((o) => ({ value: String(o.id), depth: o.depth, label: <IconLabel icon={nodeIcon(o.type, o.path)}>{o.label}</IconLabel> })),
  ];
  const errors = actionData?.fieldErrors ?? {};

  const parentPath =
    type === "item"
      ? (collection?.translations.find((x) => x.lang === langs.defaultLang)?.path ?? "")
      : (options.find((o) => String(o.id) === parentId)?.label.match(/\((.*)\)$/)?.[1] ?? "");
  const prefix = `${langPrefix(langs.defaultLang, langs.defaultLang)}${parentPath === "/" ? "" : parentPath}/`;

  const title =
    type === "item"
      ? t("content.newItemIn", { name: collection?.translations.find((x) => x.lang === langs.defaultLang)?.title ?? "" })
      : type === "collection"
        ? t("content.newCollection")
        : t("content.newPage");

  return (
    <>
      <PageHeader title={title} description={t("content.newDescription", { lang: languageName(langs.defaultLang) })} />
      <Card className="max-w-2xl">
        <Form method="post" className="flex flex-col gap-6">
          <CardContent>
            <FieldGroup>
              {actionData?.error && (
                <Alert variant="destructive">
                  <AlertDescription>{actionData.error}</AlertDescription>
                </Alert>
              )}
              <input type="hidden" name="type" value={type} />
              {type !== "item" ? (
                <>
                  <Field>
                    <FieldLabel>{t("content.type")}</FieldLabel>
                    <ToggleGroup
                      variant="outline"
                      value={[type]}
                      onValueChange={(value) => value[0] && setType(value[0] as typeof type)}
                    >
                      <ToggleGroupItem value="page">{t("content.typePage")}</ToggleGroupItem>
                      <ToggleGroupItem value="collection">{t("content.typeCollection")}</ToggleGroupItem>
                    </ToggleGroup>
                    <FieldDescription>{type === "page" ? t("content.typePageHelp") : t("content.typeCollectionHelp")}</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="parentId">{t("content.parent")}</FieldLabel>
                    <Select
                      name="parentId"
                      value={parentId}
                      onValueChange={(value) => setParentId(value ?? "")}
                      items={parentItems}
                    >
                      <SelectTrigger id="parentId" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {parentItems.map((o) => (
                            <SelectItem key={o.value} value={o.value} style={{ paddingLeft: `${0.375 + o.depth * 0.75}rem` }}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="template">{type === "collection" ? t("content.listTemplate") : t("content.template")}</FieldLabel>
                    <Select
                      name="template" key={type}
                      defaultValue={templateKinds(type === "collection" ? "listing" : "page")[0]?.name}
                      items={templateKinds(type === "collection" ? "listing" : "page").map((tpl) => ({ value: tpl.name, label: tpl.label }))}
                    >
                      <SelectTrigger id="template" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {templateKinds(type === "collection" ? "listing" : "page").map((tpl) => (
                            <SelectItem key={tpl.name} value={tpl.name}>
                              {tpl.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  {type === "collection" && (
                    <>
                      <Field>
                        <FieldLabel htmlFor="itemTemplate">{t("content.itemTemplate")}</FieldLabel>
                        <Select
                          name="itemTemplate"
                          defaultValue={defaultTemplate.item}
                          items={templateKinds("item").map((tpl) => ({ value: tpl.name, label: tpl.label }))}
                        >
                          <SelectTrigger id="itemTemplate" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {templateKinds("item").map((tpl) => (
                                <SelectItem key={tpl.name} value={tpl.name}>
                                  {tpl.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                      <TextField name="perPage" type="number" min={1} max={100} defaultValue={10} label={t("content.perPage")} />
                    </>
                  )}
                </>
              ) : (
                <input type="hidden" name="parentId" value={params.get("parent") ?? ""} />
              )}
              <TextField
                name="title"
                label={t("content.title")}
                required
                value={slug.title}
                onChange={(e) => slug.setTitle(e.target.value)}
                error={errors.title}
                autoFocus
              />
              <Field data-invalid={errors.slug ? true : undefined}>
                <FieldLabel htmlFor="slug">{t("content.slug")}</FieldLabel>
                <SlugInput prefix={prefix} id="slug" name="slug" value={slug.slug} onChange={(e) => slug.setSlug(e.target.value)} aria-invalid={errors.slug ? true : undefined} />
                <FieldDescription>{t("content.slugHelp")}</FieldDescription>
                {errors.slug && <FieldError>{errors.slug}</FieldError>}
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={navigation.state !== "idle"}>
              {navigation.state !== "idle" ? <Spinner data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
              {t("content.create")}
            </Button>
          </CardFooter>
        </Form>
      </Card>
    </>
  );
}
