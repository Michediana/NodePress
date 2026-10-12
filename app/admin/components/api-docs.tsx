import { ChevronRightIcon, CopyIcon, ExternalLinkIcon, PlayIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ApiDocsContext } from "~/.server/api-docs";
import { t } from "~/admin/i18n";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type Endpoint = {
  method: Method;
  path: string;
  description: string;
  body?: unknown;
  /** Upload multipart: niente esecuzione dal pannello, solo curl. */
  multipart?: boolean;
};

const methodClass: Record<Method, string> = {
  GET: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  POST: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  PUT: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  PATCH: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  DELETE: "bg-red-500/15 text-red-700 dark:text-red-400",
};

/** Endpoint di esempio compilati con id, path, lingue e menu reali del sito. */
function buildEndpoints(ctx: ApiDocsContext) {
  const lang = ctx.defaultLang;
  const read: Endpoint[] = [
    { method: "GET", path: "/languages", description: t("apiDocs.ep.languages") },
    { method: "GET", path: `/nodes?type=page&parent=root&lang=${lang}`, description: t("apiDocs.ep.nodes") },
  ];
  if (ctx.page) {
    read.push(
      { method: "GET", path: `/nodes/${ctx.page.id}?lang=${lang}`, description: t("apiDocs.ep.node", { title: ctx.page.title }) },
      { method: "GET", path: `/content?path=${encodeURIComponent(ctx.page.path)}`, description: t("apiDocs.ep.content") },
    );
  }
  if (ctx.collection) {
    read.push({
      method: "GET",
      path: `/nodes/${ctx.collection.id}/items?lang=${lang}&page=1&perPage=10`,
      description: t("apiDocs.ep.items", { title: ctx.collection.title }),
    });
  }
  if (ctx.menuLocation) {
    read.push({ method: "GET", path: `/menus/${encodeURIComponent(ctx.menuLocation)}?lang=${lang}`, description: t("apiDocs.ep.menu") });
  }

  const nodeId = ctx.page?.id ?? 1;
  const admin: Endpoint[] = [
    { method: "GET", path: "/admin/nodes?type=page&perPage=20", description: t("apiDocs.ep.adminNodes") },
    { method: "GET", path: `/admin/nodes/${nodeId}`, description: t("apiDocs.ep.adminNode") },
    {
      method: "POST",
      path: "/admin/nodes",
      description: t("apiDocs.ep.createNode"),
      body: {
        type: "page",
        parentId: null,
        translations: { [lang]: { title: "Pagina da API", slug: "pagina-da-api", status: "draft" } },
      },
    },
    {
      method: "PUT",
      path: `/admin/nodes/${nodeId}/translations/${ctx.otherLang ?? lang}`,
      description: t("apiDocs.ep.translation"),
      body: { title: ctx.page?.title ?? "Titolo", slug: "", status: "draft" },
    },
    { method: "GET", path: "/admin/media?perPage=20", description: t("apiDocs.ep.media") },
    { method: "POST", path: "/admin/media", description: t("apiDocs.ep.upload"), multipart: true },
  ];
  if (ctx.mediaId) {
    admin.push({ method: "PATCH", path: `/admin/media/${ctx.mediaId}`, description: t("apiDocs.ep.mediaAlt"), body: { alt: { [lang]: "Testo alternativo" } } });
  }
  admin.push(
    { method: "GET", path: "/admin/menus", description: t("apiDocs.ep.menus") },
    { method: "GET", path: "/admin/redirects", description: t("apiDocs.ep.redirects") },
    { method: "POST", path: "/admin/redirects", description: t("apiDocs.ep.createRedirect"), body: { fromPath: "/vecchio-url", toPath: "/", statusCode: 301 } },
    { method: "GET", path: "/admin/languages", description: t("apiDocs.ep.adminLanguages") },
    { method: "GET", path: "/admin/settings", description: t("apiDocs.ep.settings") },
    { method: "GET", path: "/admin/users", description: t("apiDocs.ep.users") },
  );
  return { read, admin };
}

function curl(baseUrl: string, endpoint: Endpoint, apiKey: string, body: string) {
  const key = apiKey || "<API_KEY>";
  const lines = [`curl${endpoint.method === "GET" ? "" : ` -X ${endpoint.method}`} "${baseUrl}${endpoint.path}"`, `  -H "Authorization: Bearer ${key}"`];
  if (endpoint.multipart) lines.push(`  -F "file=@immagine.jpg"`);
  else if (endpoint.body !== undefined) lines.push(`  -H "Content-Type: application/json"`, `  -d '${body.replace(/'/g, "'\\''")}'`);
  return lines.join(" \\\n");
}

function copy(text: string) {
  navigator.clipboard.writeText(text).then(() => toast.success(t("common.copied")));
}

type Result = { status: number; ms: number; body: string };

function EndpointRow({ endpoint, baseUrl, apiKey, publicRead }: { endpoint: Endpoint; baseUrl: string; apiKey: string; publicRead: boolean }) {
  const [body, setBody] = useState(() => (endpoint.body === undefined ? "" : JSON.stringify(endpoint.body, null, 2)));
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const url = baseUrl + endpoint.path;
  const command = curl(baseUrl, endpoint, apiKey, body);

  async function run() {
    if (endpoint.method !== "GET" && !confirm(t("apiDocs.confirmWrite", { method: endpoint.method, path: endpoint.path }))) return;
    setLoading(true);
    const started = performance.now();
    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      if (endpoint.body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetch(url, { method: endpoint.method, headers, body: endpoint.body === undefined ? undefined : body });
      const text = await response.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {}
      setResult({ status: response.status, ms: Math.round(performance.now() - started), body: pretty });
    } catch (error) {
      setResult({ status: 0, ms: Math.round(performance.now() - started), body: String(error) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Collapsible className="border-b last:border-b-0">
      <CollapsibleTrigger className="group flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50">
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
        <span className={`w-14 shrink-0 rounded px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold ${methodClass[endpoint.method]}`}>{endpoint.method}</span>
        <code className="min-w-0 truncate font-mono text-xs">{endpoint.path}</code>
        <span className="ml-auto hidden shrink-0 truncate text-xs text-muted-foreground md:block">{endpoint.description}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-3 px-4 pb-4 pl-11">
          <p className="text-sm text-muted-foreground md:hidden">{endpoint.description}</p>
          {endpoint.body !== undefined && (
            <Field>
              <FieldLabel>{t("apiDocs.body")}</FieldLabel>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(10, body.split("\n").length)} className="font-mono text-xs" />
            </Field>
          )}
          <div className="relative">
            <pre className="overflow-x-auto rounded-md bg-muted p-3 pr-10 font-mono text-xs">{command}</pre>
            <Button variant="ghost" size="icon-sm" className="absolute top-1.5 right-1.5" aria-label={t("common.copy")} onClick={() => copy(command)}>
              <CopyIcon />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {!endpoint.multipart && (
              <Button size="sm" onClick={run} disabled={loading}>
                {loading ? <Spinner /> : <PlayIcon />}
                {t("apiDocs.run")}
              </Button>
            )}
            {endpoint.method === "GET" && (
              <Button size="sm" variant="outline" render={<a href={url} target="_blank" rel="noreferrer" />} nativeButton={false}>
                <ExternalLinkIcon />
                {t("apiDocs.open")}
              </Button>
            )}
            {endpoint.method === "GET" && !publicRead && !apiKey && (
              <span className="self-center text-xs text-muted-foreground">{t("apiDocs.keyNeeded")}</span>
            )}
          </div>
          {result && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-xs">
                <Badge variant={result.status >= 200 && result.status < 300 ? "secondary" : "destructive"}>{result.status || t("apiDocs.networkError")}</Badge>
                <span className="text-muted-foreground">{result.ms} ms</span>
              </div>
              <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">{result.body}</pre>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ApiDocs({ context, initialKey }: { context: ApiDocsContext; initialKey?: string | null }) {
  const [apiKey, setApiKey] = useState(initialKey ?? "");
  // Una key appena generata viene proposta subito per le prove.
  useEffect(() => {
    if (initialKey) setApiKey(initialKey);
  }, [initialKey]);
  const { read, admin } = buildEndpoints(context);
  const rows = (list: Endpoint[], publicRead: boolean) => (
    <div className="rounded-lg border">
      {list.map((endpoint) => (
        <EndpointRow key={endpoint.method + endpoint.path} endpoint={endpoint} baseUrl={context.baseUrl} apiKey={apiKey.trim()} publicRead={publicRead} />
      ))}
    </div>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("apiDocs.title")}</CardTitle>
        <CardDescription>{t("apiDocs.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel>{t("apiDocs.baseUrl")}</FieldLabel>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-1.5 font-mono text-xs">{context.baseUrl}</code>
              <Button variant="ghost" size="icon-sm" aria-label={t("common.copy")} onClick={() => copy(context.baseUrl)}>
                <CopyIcon />
              </Button>
            </div>
            <FieldDescription>
              {context.publicApi ? t("apiDocs.publicOn") : t("apiDocs.publicOff")} {t("apiDocs.languages", { list: context.languages.join(", "), default: context.defaultLang })}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="api-docs-key">{t("apiDocs.keyLabel")}</FieldLabel>
            <Input id="api-docs-key" type="password" autoComplete="off" placeholder="np_…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="font-mono text-xs" />
            <FieldDescription>{t("apiDocs.keyHelp")}</FieldDescription>
          </Field>
        </div>
        <Tabs defaultValue="read">
          <TabsList>
            <TabsTrigger value="read">{t("apiDocs.readTab")}</TabsTrigger>
            <TabsTrigger value="admin">{t("apiDocs.adminTab")}</TabsTrigger>
          </TabsList>
          <TabsContent value="read" className="flex flex-col gap-3">
            <p className="text-muted-foreground">{t("apiDocs.readHelp")}</p>
            {rows(read, context.publicApi)}
          </TabsContent>
          <TabsContent value="admin" className="flex flex-col gap-3">
            <p className="text-muted-foreground">{t("apiDocs.adminHelp")}</p>
            {rows(admin, false)}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
