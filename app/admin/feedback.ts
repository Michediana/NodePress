import { useEffect } from "react";
import { toast } from "sonner";

export type ActionResult = {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
};

/** Mostra un toast quando un'action restituisce `message` o `error`. */
export function useActionToast(result: ActionResult | undefined) {
  useEffect(() => {
    if (!result) return;
    if (result.error) toast.error(result.error);
    else if (result.message) toast.success(result.message);
  }, [result]);
}
