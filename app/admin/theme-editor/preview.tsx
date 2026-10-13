import { ExternalLinkIcon, MonitorIcon, RotateCwIcon, SmartphoneIcon, TabletIcon } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { t } from "~/admin/i18n";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

export type PreviewHandle = { reload: () => void };

const VIEWPORTS = { desktop: null, tablet: 768, mobile: 390 } as const;
type Viewport = keyof typeof VIEWPORTS;

/**
 * Anteprima della bozza nel vero front SSR, in un iframe sandbox.
 * Di default gli script non girano (`allow-same-origin` senza `allow-scripts`): si vede l'HTML del
 * server con il CSS del tema e il codice del tema non può agire con la sessione del pannello.
 * Con "Esegui JS" l'iframe esegue anche gli script, come farebbe il sito pubblicato. Se il pannello ha
 * un'origine separata (`publicPreview`), questa anteprima si apre sul sito pubblico con un token: il JS
 * del tema non gira mai sull'origine del pannello.
 */
export function Preview({
  ref,
  theme,
  publicPreview,
}: {
  ref?: Ref<PreviewHandle>;
  theme: string;
  /** URL dell'anteprima sull'origine pubblica (con token), oppure null se il pannello sta sulla stessa origine. */
  publicPreview: string | null;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [path, setPath] = useState("/");
  const [input, setInput] = useState("/");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [scripts, setScripts] = useState(false);
  const [reloads, setReloads] = useState(0);
  const remote = scripts && publicPreview !== null;
  // L'URL iniziale imposta il cookie di anteprima; le ricariche usano la posizione attuale dell'iframe.
  const [src, setSrc] = useState(`/?np_preview=${encodeURIComponent(theme)}`);

  useEffect(() => {
    setSrc(`${path}${path.includes("?") ? "&" : "?"}np_preview=${encodeURIComponent(theme)}`);
    // Solo al cambio di tema: la navigazione nell'iframe aggiorna `path` da sé.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Uscendo dall'editor l'anteprima si chiude, così il sito torna a mostrare la versione pubblicata.
  // Il controllo dopo un tick evita di chiuderla nel doppio montaggio di StrictMode.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (!mounted.current)
          fetch("/?np_preview=off", { redirect: "manual", credentials: "same-origin" }).catch(() => {});
      }, 50);
    };
  }, []);

  const currentPath = () => {
    try {
      const location = frame.current?.contentWindow?.location;
      return location
        ? location.pathname + location.search.replace(/[?&]np_preview=[^&]*/, "").replace(/^&/, "?")
        : path;
    } catch {
      return path;
    }
  };

  // Prima rinnova il cookie dell'anteprima (scade dopo 30 minuti), poi ricarica dove si trova l'iframe.
  const reload = async () => {
    if (remote) {
      // Iframe su un'altra origine: non si può ricaricare da qui, si rimonta.
      setReloads((n) => n + 1);
      return;
    }
    await fetch(`/?np_preview=${encodeURIComponent(theme)}`, { redirect: "manual", credentials: "same-origin" }).catch(
      () => {},
    );
    try {
      frame.current?.contentWindow?.location.reload();
    } catch {
      setSrc(currentPath());
    }
  };

  useImperativeHandle(ref, () => ({ reload }), [theme, remote]);

  /** Lo stesso percorso sull'origine pubblica, con i parametri dell'anteprima (tema e token). */
  const publicSrc = (target: string) => {
    const base = new URL(publicPreview!);
    const url = new URL(target, base.origin);
    for (const [key, value] of base.searchParams) url.searchParams.set(key, value);
    return url.href;
  };

  const go = (target: string) => {
    const clean = target.startsWith("/") ? target : `/${target}`;
    setPath(clean);
    setInput(clean);
    setSrc(clean);
  };

  const width = VIEWPORTS[viewport];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            go(input);
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label={t("appearance.editor.previewPath")}
            className="h-7 font-mono text-xs"
          />
        </form>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon-sm" onClick={reload} aria-label={t("appearance.editor.reload")} />
            }
          >
            <RotateCwIcon />
          </TooltipTrigger>
          <TooltipContent>{t("appearance.editor.reload")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                nativeButton={false}
                render={
                  <a href={publicPreview ? publicSrc(currentPath()) : currentPath()} target="_blank" rel="noreferrer" />
                }
                aria-label={t("appearance.editor.openPreview")}
              />
            }
          >
            <ExternalLinkIcon />
          </TooltipTrigger>
          <TooltipContent>{t("appearance.editor.openPreview")}</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5">
        <ToggleGroup
          value={[viewport]}
          onValueChange={(value) => value[0] && setViewport(value[0] as Viewport)}
          size="sm"
        >
          <ToggleGroupItem value="desktop" aria-label={t("appearance.editor.desktop")}>
            <MonitorIcon />
          </ToggleGroupItem>
          <ToggleGroupItem value="tablet" aria-label={t("appearance.editor.tablet")}>
            <TabletIcon />
          </ToggleGroupItem>
          <ToggleGroupItem value="mobile" aria-label={t("appearance.editor.mobile")}>
            <SmartphoneIcon />
          </ToggleGroupItem>
        </ToggleGroup>
        <Tooltip>
          <TooltipTrigger render={<label className="flex items-center gap-2 text-xs text-muted-foreground" />}>
            <Switch
              size="sm"
              checked={scripts}
              onCheckedChange={(checked) => {
                setSrc(currentPath());
                setScripts(checked);
              }}
            />
            {t("appearance.editor.runScripts")}
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{t("appearance.editor.runScriptsHelp")}</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-muted/40">
        <iframe
          key={`${scripts ? "scripts" : "static"}-${reloads}`}
          ref={frame}
          src={remote ? publicSrc(src) : src}
          title={t("appearance.editor.previewTitle")}
          sandbox={scripts ? "allow-same-origin allow-scripts allow-forms" : "allow-same-origin"}
          className="h-full border-0 bg-white"
          style={{ width: width ?? "100%", maxWidth: "100%" }}
          onLoad={() => {
            const current = currentPath();
            setPath(current);
            setInput(current);
          }}
        />
      </div>
    </div>
  );
}
