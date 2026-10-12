// Stringhe dell'interfaccia del pannello. Per ora esiste solo l'italiano,
// ma tutte le stringhe passano da `t()` per poter aggiungere altre lingue.
import { it } from "./locales/it";

type Dict = { [key: string]: string | Dict };

const dictionaries: Record<string, Dict> = { it };
let current: Dict = it;

export function setAdminLocale(locale: string) {
  current = dictionaries[locale] ?? it;
}

/** Traduce una chiave puntata (es. "nav.content"), con interpolazione `{name}`. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let value: string | Dict | undefined = current;
  for (const part of key.split(".")) {
    value = typeof value === "object" ? value[part] : undefined;
  }
  if (typeof value !== "string") return key;
  return vars ? value.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`)) : value;
}
