// Conferme e richieste di testo del pannello con l'AlertDialog di shadcn, al posto
// di `confirm()` e `prompt()` del browser. Si usano in modo imperativo:
//   if (await confirmDialog({ description: "..." })) ...
// e richiedono `<DialogHost />` montato una volta nel layout del pannello.
import { CheckIcon, TrashIcon, XIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { t } from "~/admin/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Input } from "~/components/ui/input";

type ConfirmOptions = {
  title?: string;
  description: string;
  confirmLabel?: string;
  /** Azione distruttiva (eliminazioni, revoche): pulsante rosso. */
  destructive?: boolean;
};

type PromptOptions = {
  title: string;
  description?: string;
  defaultValue?: string;
  confirmLabel?: string;
};

type Request =
  | { kind: "confirm"; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "prompt"; options: PromptOptions; resolve: (value: string | null) => void };

let current: Request | null = null;
const listeners = new Set<() => void>();

function show(request: Request) {
  // Una nuova richiesta chiude quella aperta come annullata.
  if (current) settle(null);
  current = request;
  listeners.forEach((l) => l());
}

function settle(value: string | boolean | null) {
  const request = current;
  if (!request) return;
  current = null;
  if (request.kind === "confirm") request.resolve(value === true);
  else request.resolve(typeof value === "string" ? value : null);
  listeners.forEach((l) => l());
}

/** Chiede conferma; risolve `true` se l'utente conferma. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => show({ kind: "confirm", options, resolve }));
}

/** Chiede un testo; risolve `null` se l'utente annulla. */
export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => show({ kind: "prompt", options, resolve }));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function DialogHost() {
  const request = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  // Tiene l'ultima richiesta durante l'animazione di chiusura.
  const [shown, setShown] = useState<Request | null>(null);
  if (request && request !== shown) setShown(request);
  const view = request ?? shown;

  return (
    <AlertDialog open={!!request} onOpenChange={(open) => !open && settle(null)}>
      <AlertDialogContent>
        {view?.kind === "confirm" && <ConfirmBody options={view.options} />}
        {view?.kind === "prompt" && <PromptBody key={view === request ? "open" : "closing"} options={view.options} />}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmBody({ options }: { options: ConfirmOptions }) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{options.title ?? t("common.confirmTitle")}</AlertDialogTitle>
        <AlertDialogDescription>{options.description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>
          <XIcon data-icon="inline-start" />
          {t("common.cancel")}
        </AlertDialogCancel>
        <AlertDialogAction variant={options.destructive ? "destructive" : "default"} onClick={() => settle(true)}>
          {options.destructive ? <TrashIcon data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
          {options.confirmLabel ?? t("common.confirm")}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}

function PromptBody({ options }: { options: PromptOptions }) {
  const [value, setValue] = useState(options.defaultValue ?? "");
  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        settle(value);
      }}
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{options.title}</AlertDialogTitle>
        {options.description && <AlertDialogDescription>{options.description}</AlertDialogDescription>}
      </AlertDialogHeader>
      <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} />
      <AlertDialogFooter>
        <AlertDialogCancel>
          <XIcon data-icon="inline-start" />
          {t("common.cancel")}
        </AlertDialogCancel>
        <AlertDialogAction type="submit">
          <CheckIcon data-icon="inline-start" />
          {options.confirmLabel ?? t("common.confirm")}
        </AlertDialogAction>
      </AlertDialogFooter>
    </form>
  );
}
