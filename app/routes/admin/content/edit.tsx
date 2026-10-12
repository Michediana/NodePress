import { and, eq, inArray } from "drizzle-orm";
import { ExternalLinkIcon, ListIcon, SaveIcon, TrashIcon } from "lucide-react";
import { useState } from "react";
import { Form, Link, redirect, useNavigation, useSubmit } from "react-router";
import { z } from "zod";
import { getUser } from "~/.server/auth";
import { db, schema } from "~/.server/db";
import { checkbox, formToObject, handleUserErrors, parse, UserError } from "~/.server/forms";
import { getSiteLanguages } from "~/.server/languages";
import { deleteNode, deleteTranslation, getNodeForUser, getTreeOptions, saveTranslation, updateNode } from "~/.server/nodes";
import { TextareaField, TextField } from "~/admin/components/fields";
import { PageHeader } from "~/admin/components/page-header";
import { SlugInput, useAutoSlug } from "~/admin/components/slug-input";
import { StatusBadge } from "~/admin/components/status-badge";
import { BlockEditor } from "~/admin/editor/block-editor";
import { SeoPanel, type SeoState } from "~/admin/editor/seo-panel";
import { useActionToast, type ActionResult } from "~/admin/feedback";
import { t } from "~/admin/i18n";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select";
import { Spinner } from "~/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { walkDoc, type ContentDoc } from "~/lib/content";
import { languageName, langPrefix, localizedUrl } from "~/lib/languages";
import { effectiveStatus } from "~/lib/status";
import { defaultTemplate, templateKinds } from "~/templates/registry";
import type { Route } from "./+types/edit";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const user = getUser(context);
  const node = await getNodeForUser(user, Number(params.id));
  const langs = await getSiteLanguages();
  const requested = new URL(request.url).searchParams.get("lang");
  const lang = requested && langs.codes.includes(requested) ? requested : langs.defaultLang;
  const translation = node.translations.find((x) => x.lang === lang) ?? null;

  // Percorso del genitore nella lingua corrente (per prefisso e validazione).
  let parentPath: string | null = null;
  let parentMissing = false;
  if (node.parentId) {
    const [row] = await db
      .select({ path: schema.nodeTranslations.path })
      .from(schema.nodeTranslations)
      .where(and(eq(schema.nodeTranslations.nodeId, node.parentId), eq(schema.nodeTranslations.lang, lang)));
    parentPath = row?.path ?? null;
    parentMissing = !row;
  }

  // Esclude dal selettore del genitore il nodo stesso e i suoi discendenti.
  const options = await getTreeOptions(langs.defaultLang);
  let depth = -1;
  const parentOptions = options.filter((o) => {
    if (o.id === node.id) {
      depth = o.depth;
      return false;
    }
    if (depth >= 0 && o.depth > depth) {
      return false;
    }
    depth = -1;
    return o.type === "page";
  });

  // Media usati nel contenuto e immagine OG.
  const mediaIds = new Set<number>();
  walkDoc(translation?.content, (n) => {
    if (n.type === "image" && n.attrs?.mediaId) mediaIds.add(Number(n.attrs.mediaId));
  });
  if (translation?.ogImageId) mediaIds.add(translation.ogImageId);
  const media = mediaIds.size
    ? await db.select().from(schema.media).where(inArray(schema.media.id, [...mediaIds]))
    : [];

  let collection = null;
  if (node.type === "item" && node.parentId) {
    collection = await db.query.nodes.findFirst({
      where: eq(schema.nodes.id, node.parentId),
      with: { translations: { columns: { lang: true, title: true } } },
    });
  }

  return {
    node: { ...node, translations: node.translations.map(({ content: _c, ...rest }) => rest) },
    translation,
    lang,
    langs,
    parentPath,
    parentMissing,
    parentOptions,
    media,
    collection,
  };
}

const saveSchema = z.object({
  title: z.string().trim().min(1).max(255),
  slug: z.string().trim().max(191),
  excerpt: z.string().max(5000).optional(),
  content: z.string().transform((value, ctx) => {
    try {
      const doc = JSON.parse(value || "null") as ContentDoc | null;
      if (doc && doc.type !== "doc") throw new Error();
      return doc;
    } catch {
      ctx.addIssue({ code: "custom", message: "Contenuto non valido." });
      return null;
    }
  }),
  status: z.enum(["draft", "published", "scheduled"]),
  publishedAt: z
    .string()
    .optional()
    .transform((v) => (v ? new Date(v) : null))
    .refine((d) => d === null || !Number.isNaN(d.getTime()), "Data non valida."),
  seoTitle: z.string().max(255).optional(),
  seoDescription: z.string().max(1000).optional(),
  focusKeyword: z.string().max(255).optional(),
  ogImageId: z.coerce.number().int().optional(),
  noindex: checkbox,
  parentId: z.coerce.number().int().optional().transform((v) => v || null),
  template: z.string().optional(),
  itemTemplate: z.string().optional(),
  perPage: z.coerce.number().int().min(1).max(100).optional(),
});

export async function action({ request, params, context }: Route.ActionArgs) {
  const user = getUser(context);
  const node = await getNodeForUser(user, Number(params.id));
  const form = formToObject(await request.formData());
  const lang = String(form.lang ?? "");
  return handleUserErrors(async () => {
    if (form.intent === "deleteNode") {
      await deleteNode(node.id);
      throw redirect(node.type === "item" && node.parentId ? `/admin/content/${node.parentId}/items` : "/admin/content");
    }
    if (form.intent === "deleteTranslation") {
      if (node.translations.length <= 1) throw new UserError(t("content.lastTranslation"));
      await deleteTranslation(node.id, lang);
      throw redirect(`/admin/content/${node.id}`);
    }
    const input = parse(saveSchema, form);
    if (node.type !== "item") {
      await updateNode(node.id, {
        parentId: input.parentId,
        template: input.template || node.template,
        itemTemplate: input.itemTemplate ?? node.itemTemplate,
        perPage: input.perPage,
      });
    }
    await saveTranslation(node.id, lang, input);
    return { message: t("common.saved") };
  });
}

/** Valore per <input type="datetime-local"> nel fuso del browser. */
function toLocalInput(date: Date | string | null) {
  if (!date) return "";
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EditContent({ loaderData, actionData }: Route.ComponentProps) {
  // Rimonta il form quando cambia la lingua, così lo stato locale riparte dai dati caricati.
  return <Editor key={`${loaderData.node.id}-${loaderData.lang}`} loaderData={loaderData} actionData={actionData} />;
}

function Editor({ loaderData, actionData: rawActionData }: Pick<Route.ComponentProps, "loaderData" | "actionData">) {
  const actionData = rawActionData as ActionResult | undefined;
  useActionToast(actionData);
  const { node, translation, lang, langs, parentPath, parentMissing, parentOptions, media, collection } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const errors = actionData?.fieldErrors ?? {};
  const busy = navigation.state === "submitting";

  const slug = useAutoSlug(translation?.title ?? "", translation?.slug ?? "", !translation);
  const [doc, setDoc] = useState<ContentDoc | null>(translation?.content ?? null);
  const [status, setStatus] = useState(translation ? effectiveStatus(translation.status, translation.publishedAt) : "draft");
  const [publishedLocal, setPublishedLocal] = useState(toLocalInput(translation?.publishedAt ?? null));
  const [seo, setSeo] = useState<SeoState>({
    seoTitle: translation?.seoTitle ?? "",
    seoDescription: translation?.seoDescription ?? "",
    focusKeyword: translation?.focusKeyword ?? "",
    ogImageId: translation?.ogImageId ?? null,
    noindex: translation?.noindex ?? false,
  });
  const [parentId, setParentId] = useState(String(node.parentId ?? ""));

  const currentParentPath =
    node.type === "item" || String(node.parentId ?? "") === parentId
      ? parentPath
      : (parentOptions.find((o) => String(o.id) === parentId)?.label.match(/\((.*)\)$/)?.[1] ?? null);
  const prefix = `${langPrefix(lang, langs.defaultLang)}${currentParentPath && currentParentPath !== "/" ? currentParentPath : ""}/`;
  const isRootPage = node.type === "page" && !parentId;
  const publicUrl = translation ? localizedUrl(translation.path, lang, langs.defaultLang) : null;
  const isPublished = translation && effectiveStatus(translation.status, translation.publishedAt) === "published";
  const mainTitle = node.translations.find((x) => x.lang === langs.defaultLang)?.title;

  const destructive = (intent: string, message: string) => {
    if (confirm(message)) submit({ intent, lang }, { method: "post" });
  };

  return (
    <Form method="post" className="flex flex-col gap-6">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="content" value={JSON.stringify(doc)} />
      <PageHeader
        title={translation?.title || mainTitle || t("content.untitled")}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {t(`content.type${node.type === "page" ? "Page" : node.type === "collection" ? "Collection" : "Item"}`)}
            {collection && (
              <>
                ·
                <Link className="underline" to={`/admin/content/${collection.id}/items`}>
                  {collection.translations.find((x) => x.lang === langs.defaultLang)?.title}
                </Link>
              </>
            )}
            {translation && <StatusBadge status={translation.status} publishedAt={translation.publishedAt} />}
          </span>
        }
        actions={
          <>
            {node.type === "collection" && (
              <Button variant="outline" nativeButton={false} render={<Link to={`/admin/content/${node.id}/items`} />}>
                <ListIcon data-icon="inline-start" />
                {t("content.items")}
              </Button>
            )}
            {isPublished && publicUrl && (
              <Button variant="outline" nativeButton={false} render={<a href={publicUrl} target="_blank" rel="noreferrer" />}>
                <ExternalLinkIcon data-icon="inline-start" />
                {t("common.view")}
              </Button>
            )}
            <Button type="submit" name="intent" value="save" disabled={busy || parentMissing}>
              {busy ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
              {translation ? t("common.save") : t("content.createTranslation")}
            </Button>
          </>
        }
      />

      <Tabs value={lang}>
        <TabsList>
          {langs.codes.map((code) => {
            const exists = node.translations.some((x) => x.lang === code);
            return (
              <TabsTrigger key={code} value={code} render={<Link to={`?lang=${code}`} replace />} nativeButton={false}>
                <span className={exists ? undefined : "text-muted-foreground line-through decoration-dashed"}>{languageName(code)}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {parentMissing && (
        <Alert variant="destructive">
          <AlertDescription>{t("content.parentUntranslated")}</AlertDescription>
        </Alert>
      )}
      {!translation && !parentMissing && (
        <Alert>
          <AlertDescription>{t("content.missingTranslation", { lang: languageName(lang) })}</AlertDescription>
        </Alert>
      )}
      {actionData?.error && (
        <Alert variant="destructive">
          <AlertDescription>{actionData.error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <FieldGroup>
            <TextField
              name="title"
              label={t("content.title")}
              value={slug.title}
              onChange={(e) => slug.setTitle(e.target.value)}
              required
              error={errors.title}
              className="h-10 text-lg"
            />
            <Field data-invalid={errors.slug ? true : undefined}>
              <FieldLabel htmlFor="slug">{t("content.slug")}</FieldLabel>
              <SlugInput
                prefix={prefix}
                id="slug"
                name="slug"
                value={slug.slug}
                onChange={(e) => slug.setSlug(e.target.value)}
                aria-invalid={errors.slug ? true : undefined}
              />
              <FieldDescription>{isRootPage ? t("content.slugHomeHelp") : t("content.slugChangeHelp")}</FieldDescription>
              {errors.slug && <FieldError>{errors.slug}</FieldError>}
            </Field>
          </FieldGroup>
          <BlockEditor value={doc} onChange={setDoc} />
          <TextareaField name="excerpt" label={t("content.excerpt")} description={t("content.excerptHelp")} defaultValue={translation?.excerpt ?? ""} rows={3} />
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("content.publication")}</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="status">{t("content.status")}</FieldLabel>
                  <NativeSelect id="status" name="status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-full">
                    <NativeSelectOption value="draft">{t("status.draft")}</NativeSelectOption>
                    <NativeSelectOption value="published">{t("status.published")}</NativeSelectOption>
                    <NativeSelectOption value="scheduled">{t("status.scheduled")}</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="publishedLocal">{t("content.publishedAt")}</FieldLabel>
                  <Input id="publishedLocal" type="datetime-local" value={publishedLocal} onChange={(e) => setPublishedLocal(e.target.value)} required={status === "scheduled"} />
                  <input type="hidden" name="publishedAt" value={publishedLocal ? new Date(publishedLocal).toISOString() : ""} />
                  <FieldDescription>{status === "scheduled" ? t("content.scheduledHelp") : t("content.publishedAtHelp")}</FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          {node.type !== "item" && (
            <Card>
              <CardHeader>
                <CardTitle>{t("content.nodeSettings")}</CardTitle>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="parentId">{t("content.parent")}</FieldLabel>
                    <NativeSelect id="parentId" name="parentId" value={parentId} onChange={(e) => setParentId(e.target.value)} className="w-full">
                      <NativeSelectOption value="">{t("content.root")}</NativeSelectOption>
                      {parentOptions.map((o) => (
                        <NativeSelectOption key={o.id} value={o.id}>
                          {"  ".repeat(o.depth)}
                          {o.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <FieldDescription>{t("content.parentHelp")}</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="template">{node.type === "collection" ? t("content.listTemplate") : t("content.template")}</FieldLabel>
                    <NativeSelect id="template" name="template" defaultValue={node.template} className="w-full">
                      {templateKinds(node.type === "collection" ? "listing" : "page").map((tpl) => (
                        <NativeSelectOption key={tpl.name} value={tpl.name}>
                          {tpl.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  {node.type === "collection" && (
                    <>
                      <Field>
                        <FieldLabel htmlFor="itemTemplate">{t("content.itemTemplate")}</FieldLabel>
                        <NativeSelect id="itemTemplate" name="itemTemplate" defaultValue={node.itemTemplate ?? defaultTemplate.item} className="w-full">
                          {templateKinds("item").map((tpl) => (
                            <NativeSelectOption key={tpl.name} value={tpl.name}>
                              {tpl.label}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </Field>
                      <TextField name="perPage" type="number" min={1} max={100} defaultValue={node.perPage} label={t("content.perPage")} />
                    </>
                  )}
                </FieldGroup>
              </CardContent>
            </Card>
          )}

          <SeoPanel
            value={seo}
            onChange={setSeo}
            title={slug.title}
            slug={slug.slug}
            doc={doc}
            url={`${prefix}${slug.slug}`}
            media={media}
            lang={lang}
          />

          <Card>
            <CardHeader>
              <CardTitle>{t("content.dangerZone")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {translation && node.translations.length > 1 && (
                <Button type="button" variant="destructive" onClick={() => destructive("deleteTranslation", t("content.confirmDeleteTranslation"))}>
                  <TrashIcon data-icon="inline-start" />
                  {t("content.deleteTranslation", { lang: languageName(lang) })}
                </Button>
              )}
              <Button type="button" variant="destructive" onClick={() => destructive("deleteNode", t("content.confirmDelete"))}>
                <TrashIcon data-icon="inline-start" />
                {t("content.deleteNode")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </Form>
  );
}
