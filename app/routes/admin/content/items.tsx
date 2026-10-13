import { eq } from "drizzle-orm";
import { ArrowLeftIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { Link } from "react-router";
import { getUser } from "~/.server/auth";
import { db, schema } from "~/.server/db";
import { getSiteLanguages } from "~/.server/languages";
import { canEditNode, getItems } from "~/.server/nodes";
import { PageHeader } from "~/admin/components/page-header";
import { pageParam, Pager } from "~/admin/components/pager";
import { StatusBadge } from "~/admin/components/status-badge";
import { TranslationBadges } from "~/admin/components/translation-badges";
import { t } from "~/admin/i18n";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import type { Route } from "./+types/items";

const PER_PAGE = 25;

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const user = getUser(context);
  const collection = await db.query.nodes.findFirst({
    where: eq(schema.nodes.id, Number(params.id)),
    with: { translations: { columns: { lang: true, title: true } } },
  });
  if (collection?.type !== "collection") throw new Response("Raccoglitore non trovato", { status: 404 });
  const page = pageParam(request);
  const langs = await getSiteLanguages();
  const { items, total } = await getItems(collection.id, { page, perPage: PER_PAGE });
  return {
    collection,
    langs,
    page,
    total,
    perPage: PER_PAGE,
    canEditCollection: canEditNode(user, collection),
    items: items.map((item) => ({ ...item, editable: canEditNode(user, item) })),
  };
}

export default function CollectionItems({ loaderData }: Route.ComponentProps) {
  const { collection, langs, items } = loaderData;
  const name = collection.translations.find((x) => x.lang === langs.defaultLang)?.title ?? `#${collection.id}`;
  return (
    <>
      <PageHeader
        title={name}
        description={t("content.itemsDescription")}
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link to="/admin/content" />}>
              <ArrowLeftIcon data-icon="inline-start" />
              {t("nav.content")}
            </Button>
            {loaderData.canEditCollection && (
              <Button variant="outline" nativeButton={false} render={<Link to={`/admin/content/${collection.id}`} />}>
                <SettingsIcon data-icon="inline-start" />
                {t("content.editCollection")}
              </Button>
            )}
            <Button nativeButton={false} render={<Link to={`/admin/content/new?type=item&parent=${collection.id}`} />}>
              <PlusIcon data-icon="inline-start" />
              {t("content.addItem")}
            </Button>
          </>
        }
      />
      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("content.noItems")}</EmptyTitle>
            <EmptyDescription>{t("content.noItemsDescription")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button nativeButton={false} render={<Link to={`/admin/content/new?type=item&parent=${collection.id}`} />}>
              <PlusIcon data-icon="inline-start" />
              {t("content.addItem")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">{t("content.title")}</TableHead>
                  <TableHead>{t("content.status")}</TableHead>
                  <TableHead>{t("content.translations")}</TableHead>
                  <TableHead>{t("content.author")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const main = item.translations.find((x) => x.lang === langs.defaultLang) ?? item.translations[0];
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="pl-4">
                        {item.editable ? (
                          <Link to={`/admin/content/${item.id}`} className="font-medium hover:underline">
                            {main?.title ?? t("content.untitled")}
                          </Link>
                        ) : (
                          <span className="font-medium">{main?.title ?? t("content.untitled")}</span>
                        )}
                        <div className="text-xs text-muted-foreground">{main?.path}</div>
                      </TableCell>
                      <TableCell>{main && <StatusBadge status={main.status} publishedAt={main.publishedAt} />}</TableCell>
                      <TableCell>
                        <TranslationBadges nodeId={item.id} langs={langs.codes} translations={item.translations} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.author?.name ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <Pager page={loaderData.page} total={loaderData.total} perPage={loaderData.perPage} />
    </>
  );
}
