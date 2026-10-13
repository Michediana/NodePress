import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { UserError } from "./forms";

// Richieste verso URL indicati da fuori (upload da URL, metadati dei client OAuth): solo indirizzi
// pubblici, perché un URL che punta alla rete interna o al server stesso potrebbe leggere servizi
// privati e pubblicarne il contenuto.

const MAX_REDIRECTS = 3;

/** Indirizzi non pubblici: loopback, reti private, link-local, CGNAT, multicast. */
function isPrivateAddress(address: string) {
  const ip = address.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  return ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80");
}

async function assertPublicUrl(url: URL, options: { httpsOnly?: boolean }) {
  const allowed = options.httpsOnly ? ["https:"] : ["https:", "http:"];
  if (!allowed.includes(url.protocol))
    throw new UserError(options.httpsOnly ? "Sono ammessi solo URL https." : "Sono ammessi solo URL http e https.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (!addresses.length || addresses.some(isPrivateAddress))
    throw new UserError("L'URL punta a un indirizzo di rete privato: non è ammesso.");
}

/**
 * Scarica un URL pubblico seguendo pochi redirect, ognuno controllato, con limite di dimensione.
 * Resta il rischio di un DNS che cambia risposta tra il controllo e la connessione.
 */
export async function fetchPublic(
  source: string,
  options: { maxBytes: number; timeout: number; httpsOnly?: boolean; accept?: string },
) {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new UserError("URL non valido.");
  }
  const tooLarge = () =>
    new UserError(`Il file supera la dimensione massima di ${Math.round(options.maxBytes / 1024 / 1024) || 1} MB.`);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url, options);
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeout),
      headers: options.accept ? { Accept: options.accept } : {},
    });
    const location = response.headers.get("Location");
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new UserError(`Download non riuscito: HTTP ${response.status}.`);
    if (Number(response.headers.get("Content-Length") ?? 0) > options.maxBytes) throw tooLarge();
    const data = Buffer.from(await response.arrayBuffer());
    if (data.byteLength > options.maxBytes) throw tooLarge();
    return { data, url, mime: response.headers.get("Content-Type") ?? "" };
  }
  throw new UserError("Troppi redirect.");
}
