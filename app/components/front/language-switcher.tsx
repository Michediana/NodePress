import { Link } from "react-router";
import { nativeLanguageName } from "~/lib/languages";
import { cn } from "~/lib/utils";
import { usePage, useSite } from "./site";

/**
 * Selettore lingua: mostra solo le lingue in cui il contenuto corrente esiste.
 * Fuori da una pagina di contenuto rimanda alla home di ogni lingua.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const site = useSite();
  const page = usePage();
  const links = page
    ? page.alternates
    : site.codes.map((lang) => ({ lang, href: lang === site.defaultLang ? "/" : `/${lang}` }));
  if (links.length < 2) return null;
  return (
    <nav aria-label="Language" className={cn("flex items-center gap-1 text-sm", className)}>
      {links.map((link) => (
        <Link
          key={link.lang}
          to={link.href}
          hrefLang={link.lang}
          lang={link.lang}
          aria-current={link.lang === site.lang ? "true" : undefined}
          title={nativeLanguageName(link.lang)}
          className={cn(
            "rounded-md px-2 py-1 uppercase transition-colors hover:bg-muted",
            link.lang === site.lang ? "font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          {link.lang}
        </Link>
      ))}
    </nav>
  );
}
