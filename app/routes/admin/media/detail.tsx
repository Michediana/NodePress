import { ArrowLeftIcon, TrashIcon } from "lucide-react";
import { Form, Link, redirect } from "react-router";
import { getUser, requirePermission } from "~/.server/auth";
import { handleUserErrors, UserError } from "~/.server/forms";
import { getSiteLanguages } from "~/.server/languages";
import { deleteMedia, getMedia, updateMediaAlt } from "~/.server/media";
import { TextField } from "~/admin/components/fields";
import { PageHeader } from "~/admin/components/page-header";
import { SettingsCard } from "~/admin/components/settings-form";
import { useActionToast } from "~/admin/feedback";
import { t } from "~/admin/i18n";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { languageName } from "~/lib/languages";
import { formatBytes, isImage, mediaUrl } from "~/lib/media";
import { can } from "~/lib/roles";
import type { Route } from "./+types/detail";

export async function loader({ params, context }: Route.LoaderArgs) {
  const user = requirePermission(context, "media.upload");
  const media = await getMedia(Number(params.id));
  if (!media) throw new Response("Media non trovato", { status: 404 });
  const { codes } = await getSiteLanguages();
  return { media, langs: codes, canDelete: can(user.role, "media") || media.uploadedBy === user.id };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const user = getUser(context);
  requirePermission(context, "media.upload");
  const media = await getMedia(Number(params.id));
  if (!media) throw new Response("Media non trovato", { status: 404 });
  const form = await request.formData();
  return handleUserErrors(async () => {
    if (form.get("intent") === "delete") {
      if (!can(user.role, "media") && media.uploadedBy !== user.id) throw new UserError(t("errors.forbidden"), 403);
      await deleteMedia(media.id);
      throw redirect("/admin/media");
    }
    const { codes } = await getSiteLanguages();
    const alt: Record<string, string> = { ...media.alt };
    for (const code of codes) {
      const value = String(form.get(`alt.${code}`) ?? "").trim();
      if (value) alt[code] = value;
      else delete alt[code];
    }
    await updateMediaAlt(media.id, alt);
    return { message: t("common.saved") };
  });
}

export default function MediaDetail({ loaderData, actionData }: Route.ComponentProps) {
  useActionToast(actionData);
  const { media, langs } = loaderData;
  const url = mediaUrl(media.file);
  return (
    <>
      <PageHeader
        title={media.originalName}
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link to="/admin/media" />}>
              <ArrowLeftIcon data-icon="inline-start" />
              {t("common.back")}
            </Button>
            {loaderData.canDelete && (
              <Form
                method="post"
                onSubmit={(e) => {
                  if (!confirm(t("media.confirmDelete"))) e.preventDefault();
                }}
              >
                <Button type="submit" name="intent" value="delete" variant="destructive">
                  <TrashIcon data-icon="inline-start" />
                  {t("common.delete")}
                </Button>
              </Form>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardContent className="flex justify-center">
            {isImage(media.mime) || media.mime === "image/svg+xml" ? (
              <img src={url} alt="" className="max-h-[70vh] w-auto rounded-lg" />
            ) : media.mime.startsWith("video/") ? (
              <video src={url} controls className="max-h-[70vh] w-full rounded-lg" />
            ) : (
              <a href={url} target="_blank" rel="noreferrer" className="underline">
                {t("media.open")}
              </a>
            )}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t("media.type")}</dt>
                <dd>{media.mime}</dd>
                <dt className="text-muted-foreground">{t("media.size")}</dt>
                <dd>{formatBytes(media.size)}</dd>
                {media.width && (
                  <>
                    <dt className="text-muted-foreground">{t("media.dimensions")}</dt>
                    <dd>
                      {media.width}×{media.height}
                    </dd>
                  </>
                )}
                {media.variants.length > 1 && (
                  <>
                    <dt className="text-muted-foreground">{t("media.variants")}</dt>
                    <dd>{media.variants.map((v) => `${v.width}w`).join(", ")}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">URL</dt>
                <dd className="truncate">
                  <a href={url} target="_blank" rel="noreferrer" className="underline">
                    {url}
                  </a>
                </dd>
              </dl>
            </CardContent>
          </Card>
          {isImage(media.mime) || media.mime === "image/svg+xml" ? (
            <SettingsCard title={t("media.alt")} description={t("media.altHelp")}>
              {langs.map((code) => (
                <TextField key={code} name={`alt.${code}`} label={languageName(code)} defaultValue={media.alt[code] ?? ""} />
              ))}
            </SettingsCard>
          ) : null}
        </div>
      </div>
    </>
  );
}
