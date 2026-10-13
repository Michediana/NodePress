import { ArrowDownIcon, ArrowUpIcon, InfoIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { getAnalyticsReport, type AnalyticsReport, type Vital } from "~/.server/analytics";
import { requirePermission } from "~/.server/auth";
import { getSettings } from "~/.server/settings";
import { AreaChart } from "~/admin/components/area-chart";
import { PageHeader } from "~/admin/components/page-header";
import { t } from "~/admin/i18n";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { ANALYTICS_RANGES, type AnalyticsRange } from "~/lib/analytics";
import { can } from "~/lib/roles";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/analytics";

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requirePermission(context, "analytics");
  const param = new URL(request.url).searchParams.get("range");
  const range: AnalyticsRange = (ANALYTICS_RANGES as readonly string[]).includes(param ?? "")
    ? (param as AnalyticsRange)
    : "30";
  const [report, settings] = await Promise.all([
    getAnalyticsReport(range),
    getSettings(["analyticsEnabled", "analyticsConsent", "analyticsRetentionDays"]),
  ]);
  return { report, settings, canConfigure: can(user, "settings") };
}

// --- Formattazione ---

const number = new Intl.NumberFormat("it");
const regions = new Intl.DisplayNames("it", { type: "region" });
const languages = new Intl.DisplayNames("it", { type: "language" });

function duration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}

function safe(fn: () => string, fallback: string) {
  try {
    return fn() || fallback;
  } catch {
    return fallback;
  }
}

const labelFormats: Record<string, (value: string) => string> = {
  channel: (v) => t(`analytics.channels.${v}`),
  country: (v) => safe(() => regions.of(v) ?? v, v),
  language: (v) => safe(() => languages.of(v) ?? v, v),
  device: (v) => t(`analytics.devices.${v}`),
  scheme: (v) => t(`analytics.schemes.${v}`),
  event: (v) => {
    const key = `analytics.eventNames.${v}`;
    const translated = t(key);
    return translated === key ? v : translated;
  },
};

type Metric = "visitors" | "visits" | "pageviews" | "bounceRate" | "duration";

const metricFormat: Record<Metric | "pagesPerVisit", (value: number) => string> = {
  visitors: (v) => number.format(v),
  visits: (v) => number.format(v),
  pageviews: (v) => number.format(v),
  bounceRate: (v) => `${Math.round(v)}%`,
  duration,
  pagesPerVisit: (v) => number.format(v),
};

// --- Componenti ---

function Delta({ current, previous, inverse }: { current: number; previous: number; inverse?: boolean }) {
  if (!previous) return null;
  const change = Math.round(((current - previous) / previous) * 100);
  if (!change) return <span className="text-xs text-muted-foreground">=</span>;
  const up = change > 0;
  const good = inverse ? !up : up;
  const Icon = up ? ArrowUpIcon : ArrowDownIcon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium",
        good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {Math.abs(change)}%<span className="sr-only">{up ? t("analytics.up") : t("analytics.down")}</span>
    </span>
  );
}

type Row = { label: string; value: number; secondary?: number };

/** Lista a barre orizzontali: etichetta, barra proporzionale, valori. */
function BarList({
  rows,
  format,
  columns = [t("analytics.visits"), t("analytics.visitors")],
  extra,
  href,
}: {
  rows: Row[];
  format?: (label: string) => string;
  columns?: string[];
  extra?: (row: Row, index: number) => React.ReactNode[];
  href?: (label: string) => string | null;
}) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">{t("analytics.noData")}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex gap-4 px-2 pb-1 text-xs text-muted-foreground">
        <span className="flex-1" />
        {columns.map((c) => (
          <span key={c} className="w-16 text-right">
            {c}
          </span>
        ))}
      </div>
      {rows.map((row, index) => {
        const label = format ? format(row.label) : row.label;
        const link = href?.(row.label);
        return (
          <div key={row.label} className="flex items-center gap-4">
            <div className="relative min-w-0 flex-1">
              <div
                className="absolute inset-y-0 left-0 rounded-sm bg-muted"
                style={{ width: `${(row.value / max) * 100}%` }}
              />
              <div className="relative truncate px-2 py-1" title={row.label}>
                {link ? (
                  <a href={link} target="_blank" rel="noreferrer" className="hover:underline">
                    {label}
                  </a>
                ) : (
                  label
                )}
              </div>
            </div>
            <span className="w-16 text-right font-medium tabular-nums">{number.format(row.value)}</span>
            {extra
              ? extra(row, index).map((cell, i) => (
                  <span key={i} className="w-16 text-right text-muted-foreground tabular-nums">
                    {cell}
                  </span>
                ))
              : row.secondary !== undefined && (
                  <span className="w-16 text-right text-muted-foreground tabular-nums">
                    {number.format(row.secondary)}
                  </span>
                )}
          </div>
        );
      })}
    </div>
  );
}

type Section = { value: string; label: string; content: React.ReactNode };

function BreakdownCard({ title, sections }: { title: string; sections: Section[] }) {
  return (
    <Card>
      <Tabs defaultValue={sections[0].value} className="gap-4">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{title}</CardTitle>
          {sections.length > 1 && (
            <TabsList className="max-w-full overflow-x-auto" variant="line">
              {sections.map((s) => (
                <TabsTrigger key={s.value} value={s.value}>
                  {s.label}
                </TabsTrigger>
              ))}
            </TabsList>
          )}
        </CardHeader>
        <CardContent>
          {sections.map((s) => (
            <TabsContent key={s.value} value={s.value}>
              {s.content}
            </TabsContent>
          ))}
        </CardContent>
      </Tabs>
    </Card>
  );
}

const vitalFormat = (vital: Vital) =>
  vital.p75 === null ? "—" : vital.name === "CLS" ? (vital.p75 / 1000).toFixed(2) : `${number.format(vital.p75)} ms`;

const VITAL_LIMITS: Record<Vital["name"], [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [100, 250],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

function VitalsTable({ vitals }: { vitals: Vital[] }) {
  if (!vitals.some((v) => v.samples))
    return <p className="py-8 text-center text-sm text-muted-foreground">{t("analytics.noData")}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("analytics.metric")}</TableHead>
          <TableHead className="text-right">p75</TableHead>
          <TableHead>{t("analytics.rating")}</TableHead>
          <TableHead className="text-right">{t("analytics.goodShare")}</TableHead>
          <TableHead className="text-right">{t("analytics.samples")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {vitals.map((vital) => {
          const [good, poor] = VITAL_LIMITS[vital.name];
          const rating = vital.p75 === null ? null : vital.p75 <= good ? "good" : vital.p75 <= poor ? "needs" : "poor";
          return (
            <TableRow key={vital.name}>
              <TableCell>
                <span className="font-medium">{vital.name}</span>
                <div className="text-xs text-muted-foreground">{t(`analytics.vitals.${vital.name}`)}</div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{vitalFormat(vital)}</TableCell>
              <TableCell>
                {rating && (
                  <Badge variant={rating === "good" ? "secondary" : rating === "needs" ? "outline" : "destructive"}>
                    {t(`analytics.ratings.${rating}`)}
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {vital.samples ? `${Math.round((vital.good / vital.samples) * 100)}%` : "—"}
              </TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {number.format(vital.samples)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function bucketLabels(report: AnalyticsReport, bucket: string) {
  if (report.hourly) {
    const date = new Date(bucket + ":00Z");
    const time = date.toLocaleTimeString("it", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
    return {
      tick: time,
      label: `${date.toLocaleDateString("it", { day: "numeric", month: "short", timeZone: "UTC" })}, ${time} UTC`,
    };
  }
  const date = new Date(bucket + "T00:00:00Z");
  return {
    tick: date.toLocaleDateString("it", { day: "numeric", month: "short", timeZone: "UTC" }),
    label: date.toLocaleDateString("it", {
      weekday: "short",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
  };
}

export default function Analytics({ loaderData }: Route.ComponentProps) {
  const { report, settings, canConfigure } = loaderData;
  const [metric, setMetric] = useState<Metric>("visitors");
  const { current, previous } = report;

  const kpis: { key: Metric | "pagesPerVisit"; label: string; inverse?: boolean }[] = [
    { key: "visitors", label: t("analytics.visitors") },
    { key: "visits", label: t("analytics.visits") },
    { key: "pageviews", label: t("analytics.pageviews") },
    { key: "bounceRate", label: t("analytics.bounceRate"), inverse: true },
    { key: "duration", label: t("analytics.duration") },
    { key: "pagesPerVisit", label: t("analytics.pagesPerVisit") },
  ];
  const metricLabel = kpis.find((k) => k.key === metric)!.label;
  const chart = report.series.map((point) => ({ ...bucketLabels(report, point.bucket), value: point[metric] }));
  const pageColumns = [t("analytics.views"), t("analytics.visits"), t("analytics.time"), t("analytics.scroll")];

  return (
    <>
      <PageHeader
        title={t("analytics.title")}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5">
              <span
                className={cn("size-2 rounded-full", report.live ? "bg-emerald-500" : "bg-muted-foreground/40")}
                aria-hidden
              />
              {t("analytics.live", { count: number.format(report.live) })}
            </span>
            <span aria-hidden>·</span>
            {t("analytics.privacyNote", { days: settings.analyticsRetentionDays })}
          </span>
        }
        actions={
          <Tabs value={report.range}>
            <TabsList>
              {ANALYTICS_RANGES.map((range) => (
                <TabsTrigger
                  key={range}
                  value={range}
                  render={<Link to={`?range=${range}`} preventScrollReset />}
                  nativeButton={false}
                >
                  {t(`analytics.ranges.${range}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      />

      {!settings.analyticsEnabled && (
        <Alert>
          <InfoIcon />
          <AlertTitle>{t("analytics.disabledTitle")}</AlertTitle>
          <AlertDescription>
            {t("analytics.disabled")}{" "}
            {canConfigure && (
              <Link to="/admin/settings/tracking" className="underline">
                {t("analytics.openSettings")}
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => {
          const selectable = kpi.key !== "pagesPerVisit";
          const selected = kpi.key === metric;
          return (
            <Card
              key={kpi.key}
              size="sm"
              className={cn(
                selectable && "cursor-pointer transition-colors hover:bg-muted/50",
                selected && "ring-2 ring-primary",
              )}
              onClick={selectable ? () => setMetric(kpi.key as Metric) : undefined}
              role={selectable ? "button" : undefined}
              tabIndex={selectable ? 0 : undefined}
              aria-pressed={selectable ? selected : undefined}
              onKeyDown={
                selectable
                  ? (e: React.KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setMetric(kpi.key as Metric);
                      }
                    }
                  : undefined
              }
            >
              <CardHeader>
                <CardDescription>{kpi.label}</CardDescription>
                <CardTitle className="flex items-baseline gap-2 text-2xl tabular-nums">
                  {metricFormat[kpi.key](current[kpi.key])}
                  <Delta current={current[kpi.key]} previous={previous[kpi.key]} inverse={kpi.inverse} />
                </CardTitle>
              </CardHeader>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{metricLabel}</CardTitle>
          <CardDescription>{t(report.hourly ? "analytics.perHour" : "analytics.perDay")}</CardDescription>
        </CardHeader>
        <CardContent>
          <AreaChart data={chart} label={metricLabel} format={metricFormat[metric]} />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <BreakdownCard
          title={t("analytics.pages")}
          sections={[
            {
              value: "top",
              label: t("analytics.topPages"),
              content: (
                <BarList
                  rows={report.pages}
                  columns={pageColumns}
                  extra={(_, i) => {
                    const page = report.pages[i];
                    return [
                      number.format(page.secondary),
                      page.engaged ? duration(page.engaged) : "—",
                      page.scroll ? `${page.scroll}%` : "—",
                    ];
                  }}
                />
              ),
            },
            { value: "entry", label: t("analytics.entryPages"), content: <BarList rows={report.entries} /> },
            { value: "exit", label: t("analytics.exitPages"), content: <BarList rows={report.exits} /> },
            {
              value: "404",
              label: "404",
              content: <BarList rows={report.notFound} columns={[t("analytics.views"), t("analytics.visits")]} />,
            },
          ]}
        />
        <BreakdownCard
          title={t("analytics.sources")}
          sections={[
            {
              value: "channels",
              label: t("analytics.channel"),
              content: <BarList rows={report.channels} format={labelFormats.channel} />,
            },
            {
              value: "referrers",
              label: t("analytics.referrers"),
              content: <BarList rows={report.referrers} href={(host) => `https://${host}`} />,
            },
            { value: "source", label: "UTM source", content: <BarList rows={report.sources} /> },
            { value: "medium", label: "UTM medium", content: <BarList rows={report.mediums} /> },
            { value: "campaign", label: t("analytics.campaigns"), content: <BarList rows={report.campaigns} /> },
          ]}
        />
        <BreakdownCard
          title={t("analytics.audience")}
          sections={[
            {
              value: "countries",
              label: t("analytics.countries"),
              content: <BarList rows={report.countries} format={labelFormats.country} />,
            },
            {
              value: "lang",
              label: t("analytics.siteLanguage"),
              content: <BarList rows={report.langs} format={labelFormats.language} />,
            },
            {
              value: "browserLang",
              label: t("analytics.browserLanguage"),
              content: <BarList rows={report.browserLangs} format={labelFormats.language} />,
            },
            { value: "timezones", label: t("analytics.timezones"), content: <BarList rows={report.timezones} /> },
          ]}
        />
        <BreakdownCard
          title={t("analytics.technology")}
          sections={[
            {
              value: "devices",
              label: t("analytics.device"),
              content: <BarList rows={report.devices} format={labelFormats.device} />,
            },
            { value: "browsers", label: "Browser", content: <BarList rows={report.browsers} /> },
            { value: "os", label: t("analytics.os"), content: <BarList rows={report.oses} /> },
            { value: "screens", label: t("analytics.screens"), content: <BarList rows={report.screens} /> },
            {
              value: "schemes",
              label: t("analytics.scheme"),
              content: <BarList rows={report.schemes} format={labelFormats.scheme} />,
            },
            { value: "connections", label: t("analytics.connection"), content: <BarList rows={report.connections} /> },
          ]}
        />
        <BreakdownCard
          title={t("analytics.events")}
          sections={[
            {
              value: "events",
              label: t("analytics.allEvents"),
              content: (
                <BarList
                  rows={report.eventNames}
                  format={labelFormats.event}
                  columns={[t("analytics.count"), t("analytics.visits")]}
                />
              ),
            },
            {
              value: "outbound",
              label: t("analytics.outbound"),
              content: (
                <BarList
                  rows={report.outbound}
                  href={(url) => url}
                  columns={[t("analytics.clicks"), t("analytics.visits")]}
                />
              ),
            },
            {
              value: "downloads",
              label: t("analytics.downloads"),
              content: <BarList rows={report.downloads} columns={[t("analytics.count"), t("analytics.visits")]} />,
            },
          ]}
        />
        <Card>
          <CardHeader>
            <CardTitle>Core Web Vitals</CardTitle>
            <CardDescription>{t("analytics.vitalsHelp")}</CardDescription>
          </CardHeader>
          <CardContent>
            <VitalsTable vitals={report.vitals} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
