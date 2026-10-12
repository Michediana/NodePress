import { desc, eq, sql } from "drizzle-orm";
import { FilePlusIcon } from "lucide-react";
import { Link } from "react-router";
import { getUser } from "~/.server/auth";
import { db, schema } from "~/.server/db";
import { getSiteLanguages } from "~/.server/languages";
import { PageHeader } from "~/admin/components/page-header";
import { StatusBadge } from "~/admin/components/status-badge";
import { t } from "~/admin/i18n";
import { LanguageLabel } from "~/components/language-flag";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { effectiveStatus } from "~/lib/status";
import type { Route } from "./+types/dashboard";

export async function loader({ context }: Route.LoaderArgs) {
  const user = getUser(context);
  const { nodeTranslations: tr, nodes, media } = schema;
  const [counts, [mediaCount], recent, langs] = await Promise.all([
    db.select({ status: tr.status, publishedAt: tr.publishedAt }).from(tr),
    db.select({ n: sql<number>`count(*)` }).from(media),
    db
      .select({ nodeId: tr.nodeId, lang: tr.lang, title: tr.title, path: tr.path, status: tr.status, publishedAt: tr.publishedAt, updatedAt: tr.updatedAt })
      .from(tr)
      .innerJoin(nodes, eq(nodes.id, tr.nodeId))
      .where(user.role === "author" ? eq(nodes.authorId, user.id) : undefined)
      .orderBy(desc(tr.updatedAt))
      .limit(8),
    getSiteLanguages(),
  ]);
  const stats = { draft: 0, published: 0, scheduled: 0 };
  for (const row of counts) stats[effectiveStatus(row.status, row.publishedAt)]++;
  return { user, stats, media: Number(mediaCount.n), recent, langs };
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { user, stats, recent, langs } = loaderData;
  const cards = [
    { label: t("status.published"), value: stats.published },
    { label: t("status.scheduled"), value: stats.scheduled },
    { label: t("status.draft"), value: stats.draft },
    { label: t("nav.media"), value: loaderData.media },
  ];
  return (
    <>
      <PageHeader
        title={t("dashboard.welcome", { name: user.name })}
        description={
          <span className="flex flex-wrap items-center gap-1">
            {t("dashboard.languages")}
            {langs.codes.map((code) => (
              <Badge key={code} variant={code === langs.defaultLang ? "default" : "secondary"}>
                <LanguageLabel code={code} />
              </Badge>
            ))}
          </span>
        }
        actions={
          <Button nativeButton={false} render={<Link to="/admin/content/new" />}>
            <FilePlusIcon data-icon="inline-start" />
            {t("content.new")}
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader>
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{card.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.recent")}</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t("dashboard.emptyTitle")}</EmptyTitle>
                <EmptyDescription>{t("dashboard.emptyDescription")}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button nativeButton={false} render={<Link to="/admin/content/new" />}>
                  {t("content.new")}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("content.title")}</TableHead>
                  <TableHead>{t("languages.language")}</TableHead>
                  <TableHead>{t("content.status")}</TableHead>
                  <TableHead>{t("common.updated")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((row) => (
                  <TableRow key={`${row.nodeId}-${row.lang}`}>
                    <TableCell>
                      <Link className="font-medium hover:underline" to={`/admin/content/${row.nodeId}?lang=${row.lang}`}>
                        {row.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">{row.path}</div>
                    </TableCell>
                    <TableCell>{row.lang}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} publishedAt={row.publishedAt} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{new Date(row.updatedAt).toLocaleString("it")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
