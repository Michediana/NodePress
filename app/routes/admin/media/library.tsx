import { FileTextIcon, FilmIcon, ImageIcon, LayoutGridIcon, UploadIcon } from "lucide-react";
import { useRef } from "react";
import { Form, Link, useNavigation, useSubmit } from "react-router";
import { requirePermission } from "~/.server/auth";
import { handleUserErrors, UserError } from "~/.server/forms";
import { listMedia, uploadMedia } from "~/.server/media";
import { MediaThumb } from "~/admin/components/media-thumb";
import { PageHeader } from "~/admin/components/page-header";
import { pageParam, Pager } from "~/admin/components/pager";
import { useActionToast } from "~/admin/feedback";
import { IconLabel } from "~/admin/components/icon-label";
import { t } from "~/admin/i18n";
import { Button } from "~/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { formatBytes } from "~/lib/media";
import type { Route } from "./+types/library";

const PER_PAGE = 48;

export async function loader({ request, context }: Route.LoaderArgs) {
  requirePermission(context, "media.upload");
  const url = new URL(request.url);
  const page = pageParam(request);
  const q = url.searchParams.get("q") ?? "";
  const type = url.searchParams.get("type") ?? "";
  return { ...(await listMedia({ page, perPage: PER_PAGE, q, type })), page, perPage: PER_PAGE, q, type };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requirePermission(context, "media.upload");
  return handleUserErrors(async () => {
    const form = await request.formData();
    const files = form.getAll("files").filter((f): f is File => typeof f !== "string" && f.size > 0);
    if (!files.length) throw new UserError(t("media.noFiles"));
    const ids: number[] = [];
    for (const file of files) ids.push(await uploadMedia(file, user.id));
    return { message: t("media.uploaded", { count: ids.length }), ids };
  });
}

export default function MediaLibrary({ loaderData, actionData }: Route.ComponentProps) {
  useActionToast(actionData);
  const navigation = useNavigation();
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement>(null);
  const uploading = navigation.state === "submitting" && navigation.formMethod === "POST";
  const mediaTypes = [
    { value: "", label: <IconLabel icon={LayoutGridIcon}>{t("media.allTypes")}</IconLabel> },
    { value: "image", label: <IconLabel icon={ImageIcon}>{t("media.images")}</IconLabel> },
    { value: "video", label: <IconLabel icon={FilmIcon}>{t("media.videos")}</IconLabel> },
    { value: "document", label: <IconLabel icon={FileTextIcon}>{t("media.documents")}</IconLabel> },
  ];
  return (
    <>
      <PageHeader
        title={t("nav.media")}
        description={t("media.description")}
        actions={
          <Form method="post" encType="multipart/form-data" ref={formRef}>
            <input
              id="upload"
              type="file"
              name="files"
              multiple
              hidden
              accept="image/*,video/*,audio/*,application/pdf"
              onChange={() => formRef.current && submit(formRef.current)}
            />
            <Button type="button" disabled={uploading} onClick={() => document.getElementById("upload")?.click()}>
              {uploading ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
              {t("media.upload")}
            </Button>
          </Form>
        }
      />
      <Form method="get" className="flex flex-wrap gap-2">
        <Input name="q" placeholder={t("common.search")} defaultValue={loaderData.q} className="max-w-xs" />
        <Select name="type" defaultValue={loaderData.type} items={mediaTypes}>
          <SelectTrigger className="min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {mediaTypes.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button type="submit" variant="outline">
          {t("common.filter")}
        </Button>
      </Form>
      {loaderData.items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("media.empty")}</EmptyTitle>
            <EmptyDescription>{t("media.emptyDescription")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
          {loaderData.items.map((item) => (
            <Link key={item.id} to={`/admin/media/${item.id}`} className="group flex flex-col gap-1">
              <MediaThumb media={item} className="ring-primary transition group-hover:ring-2" />
              <span className="truncate text-xs font-medium">{item.originalName}</span>
              <span className="text-xs text-muted-foreground">
                {item.width ? `${item.width}×${item.height} · ` : ""}
                {formatBytes(item.size)}
              </span>
            </Link>
          ))}
        </div>
      )}
      <Pager page={loaderData.page} total={loaderData.total} perPage={loaderData.perPage} />
    </>
  );
}
