import { LanguagesIcon } from "lucide-react";
import { languageFlag, languageName } from "~/lib/languages";
import { cn } from "~/lib/utils";

// Gli SVG di country-flag-icons come URL: ogni bandiera si scarica solo quando serve,
// invece di finire tutte nel bundle come componenti React (~1,5 MB).
const FLAGS = import.meta.glob<string>("/node_modules/country-flag-icons/3x2/*.svg", {
  eager: true,
  import: "default",
  query: "?url&no-inline",
});

function flagUrl(country: string) {
  return FLAGS[`/node_modules/country-flag-icons/3x2/${country}.svg`];
}

/** Bandiera di una lingua (3:2). Per le lingue senza paese mostra un'icona generica. */
export function LanguageFlag({ code, className }: { code: string; className?: string }) {
  const country = languageFlag(code);
  const url = country ? flagUrl(country) : undefined;
  if (!url) return <LanguagesIcon aria-hidden="true" className={cn("size-3.5 shrink-0 text-muted-foreground", className)} />;
  return (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      loading="lazy"
      className={cn("h-3 w-[18px] shrink-0 rounded-[2px] object-cover ring-1 ring-foreground/10", className)}
    />
  );
}

/** Bandiera seguita dal nome della lingua (in italiano, o nella lingua indicata). */
export function LanguageLabel({ code, displayLocale, className }: { code: string; displayLocale?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <LanguageFlag code={code} />
      {languageName(code, displayLocale)}
    </span>
  );
}
