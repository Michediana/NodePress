import { Link } from "react-router";
import { ConsentPreferencesLink } from "~/components/front/consent";
import { LanguageSwitcher } from "~/components/front/language-switcher";
import { Menu } from "~/components/front/menu";
import { useSite } from "~/components/front/site";

/** Struttura comune dei template: header con menu e selettore lingua, footer. */
export function SiteShell({ children }: { children: React.ReactNode }) {
  const site = useSite();
  const home = site.lang === site.defaultLang ? "/" : `/${site.lang}`;
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <Link to={home} className="text-lg font-semibold tracking-tight">
            {site.siteName}
          </Link>
          <div className="flex flex-wrap items-center gap-6">
            <Menu location="header" />
            <LanguageSwitcher />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4">{children}</main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground">
          <span>
            © {new Date().getFullYear()} {site.siteName}
          </span>
          <Menu location="footer" className="text-sm" />
          <ConsentPreferencesLink className="underline-offset-4 hover:underline">Cookie</ConsentPreferencesLink>
        </div>
      </footer>
    </div>
  );
}
