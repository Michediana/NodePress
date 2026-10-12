import { data } from "react-router";
import { z } from "zod";

z.config(z.locales.it());

/** Errore applicativo con messaggio mostrabile all'utente. */
export class UserError extends Error {
  status: number;
  fieldErrors?: Record<string, string>;
  constructor(message: string, status = 400, fieldErrors?: Record<string, string>) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

/** Converte FormData in oggetto semplice (le chiavi che finiscono con [] diventano array). */
export function formToObject(form: FormData) {
  const result: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
  for (const key of new Set(form.keys())) {
    const values = form.getAll(key);
    result[key] = key.endsWith("[]") ? values : values[0];
  }
  return result;
}

/** Valida con zod; in caso di errore lancia uno UserError con `fieldErrors`. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    fieldErrors[issue.path.join(".")] ??= issue.message;
  }
  throw new UserError(Object.values(fieldErrors)[0] ?? "Dati non validi.", 400, fieldErrors);
}

export const checkbox = z
  .union([z.string(), z.boolean(), z.undefined(), z.null()])
  .transform((v) => v === true || v === "on" || v === "true" || v === "1");

/** Esegue `fn` trasformando gli UserError in risposte con `error` e `fieldErrors`. */
export async function handleUserErrors<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof UserError) {
      return data({ error: error.message, fieldErrors: error.fieldErrors }, { status: error.status });
    }
    throw error;
  }
}
