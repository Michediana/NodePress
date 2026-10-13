import { BotIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { t } from "~/admin/i18n";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";

const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success(t("common.copied")));

function Snippet({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md bg-muted p-3 pr-10 font-mono text-xs">{code}</pre>
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute top-1.5 right-1.5"
        aria-label={t("common.copy")}
        onClick={() => copy(code)}
      >
        <CopyIcon />
      </Button>
    </div>
  );
}

/** Istruzioni per collegare un assistente AI al server MCP del sito. */
export function McpSetup({ url, apiKey }: { url: string; apiKey?: string | null }) {
  const key = apiKey || "<API_KEY>";
  const claudeCodeOAuth = `claude mcp add --transport http nodepress ${url}`;
  const claudeCode = `claude mcp add --transport http nodepress ${url} --header "Authorization: Bearer ${key}"`;
  const json = JSON.stringify(
    { mcpServers: { nodepress: { type: "http", url, headers: { Authorization: `Bearer ${key}` } } } },
    null,
    2,
  );
  const desktop = JSON.stringify(
    {
      mcpServers: {
        nodepress: { command: "npx", args: ["-y", "mcp-remote", url, "--header", `Authorization: Bearer ${key}`] },
      },
    },
    null,
    2,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BotIcon className="size-4" />
          {t("mcp.title")}
        </CardTitle>
        <CardDescription>{t("mcp.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Field>
          <FieldLabel>{t("mcp.endpoint")}</FieldLabel>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-1.5 font-mono text-xs">{url}</code>
            <Button variant="ghost" size="icon-sm" aria-label={t("common.copy")} onClick={() => copy(url)}>
              <CopyIcon />
            </Button>
          </div>
          <FieldDescription>{t("mcp.scopes")}</FieldDescription>
        </Field>
        <Tabs defaultValue="claude-ai">
          <TabsList>
            <TabsTrigger value="claude-ai">claude.ai / Desktop</TabsTrigger>
            <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
            <TabsTrigger value="json">{t("mcp.otherClients")}</TabsTrigger>
          </TabsList>
          <TabsContent value="claude-ai" className="flex flex-col gap-3">
            <p className="text-muted-foreground">{t("mcp.claudeAiHelp")}</p>
            <Snippet code={url} />
            <p className="text-muted-foreground">{t("mcp.desktopHelp")}</p>
            <Snippet code={desktop} />
          </TabsContent>
          <TabsContent value="claude-code" className="flex flex-col gap-3">
            <p className="text-muted-foreground">{t("mcp.claudeCodeOAuthHelp")}</p>
            <Snippet code={claudeCodeOAuth} />
            <p className="text-muted-foreground">{t("mcp.claudeCodeHelp")}</p>
            <Snippet code={claudeCode} />
          </TabsContent>
          <TabsContent value="json" className="flex flex-col gap-3">
            <p className="text-muted-foreground">{t("mcp.jsonHelp")}</p>
            <Snippet code={json} />
          </TabsContent>
        </Tabs>
        <p className="text-muted-foreground">{t("mcp.oauthNote")}</p>
        {!apiKey && <p className="text-muted-foreground">{t("mcp.keyPlaceholder")}</p>}
      </CardContent>
    </Card>
  );
}
