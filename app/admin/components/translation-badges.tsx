import { Link } from "react-router";
import { Badge } from "~/components/ui/badge";
import { effectiveStatus, type ContentStatus } from "~/lib/status";

/** Un badge per lingua attiva: pieno se pubblicato, tratteggiato se manca la traduzione. */
export function TranslationBadges({
  nodeId,
  langs,
  translations,
}: {
  nodeId: number;
  langs: string[];
  translations: { lang: string; status: ContentStatus; publishedAt: Date | string | null }[];
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {langs.map((lang) => {
        const tr = translations.find((x) => x.lang === lang);
        const status = tr ? effectiveStatus(tr.status, tr.publishedAt) : null;
        return (
          <Badge
            key={lang}
            variant={status === "published" ? "default" : status ? "secondary" : "outline"}
            className={status ? undefined : "border-dashed text-muted-foreground"}
            render={<Link to={`/admin/content/${nodeId}?lang=${lang}`} />}
          >
            {lang}
          </Badge>
        );
      })}
    </div>
  );
}
