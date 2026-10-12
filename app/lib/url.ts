/** URL sicuro per href/src: solo http(s), mailto, tel, percorsi relativi e ancore. */
export function safeUrl(value: unknown) {
  const url = String(value ?? "").trim();
  if (!url) return "";
  if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
  // Senza schema (es. "/chi-siamo", "#top", "?page=2", "foto.webp"): niente "javascript:" & co.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return "#";
}

export const isExternalUrl = (url: string) => /^https?:/i.test(url);
