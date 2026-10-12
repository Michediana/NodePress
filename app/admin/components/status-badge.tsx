import { t } from "~/admin/i18n";
import { Badge } from "~/components/ui/badge";
import { effectiveStatus, type ContentStatus } from "~/lib/status";

export function StatusBadge({ status, publishedAt }: { status: ContentStatus; publishedAt: Date | string | null }) {
  const effective = effectiveStatus(status, publishedAt);
  const variant = effective === "published" ? "default" : effective === "scheduled" ? "secondary" : "outline";
  return (
    <Badge variant={variant} title={publishedAt ? new Date(publishedAt).toLocaleString("it") : undefined}>
      {t(`status.${effective}`)}
    </Badge>
  );
}
