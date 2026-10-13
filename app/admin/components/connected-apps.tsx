import { BotIcon, TrashIcon } from "lucide-react";
import { useSubmit } from "react-router";
import { confirmDialog } from "~/admin/components/dialogs";
import { t } from "~/admin/i18n";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "~/components/ui/item";

export type ConnectedApp = {
  id: number;
  scope: string;
  client: string;
  user: string;
  createdAt: Date | string;
  lastUsedAt: Date | string | null;
};

const formatDate = (value: Date | string) => new Date(value).toLocaleString("it");

/** Applicazioni autorizzate con OAuth; il pulsante invia `intent=revokeGrant` all'action della pagina. */
export function ConnectedApps({
  apps,
  showUser,
  className,
}: {
  apps: ConnectedApp[];
  showUser?: boolean;
  className?: string;
}) {
  const submit = useSubmit();
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t("oauth.apps")}</CardTitle>
        <CardDescription>{showUser ? t("oauth.allAppsHelp") : t("oauth.appsHelp")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {apps.length === 0 && <p className="text-sm text-muted-foreground">{t("oauth.noApps")}</p>}
        {apps.map((app) => (
          <Item key={app.id} variant="outline" size="sm">
            <ItemMedia variant="icon">
              <BotIcon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>
                {app.client}
                <Badge variant={app.scope === "admin" ? "default" : "secondary"}>{app.scope}</Badge>
              </ItemTitle>
              <ItemDescription>
                {showUser && `${app.user} · `}
                {t("oauth.connectedOn", { date: formatDate(app.createdAt) })} · {t("oauth.lastUsed")}:{" "}
                {app.lastUsedAt ? formatDate(app.lastUsedAt) : t("apiKeys.never")}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("oauth.revoke")}
                onClick={async () => {
                  if (await confirmDialog({ description: t("oauth.confirmRevoke"), confirmLabel: t("oauth.revoke"), destructive: true }))
                    submit({ intent: "revokeGrant", id: String(app.id) }, { method: "post" });
                }}
              >
                <TrashIcon />
              </Button>
            </ItemActions>
          </Item>
        ))}
      </CardContent>
    </Card>
  );
}
