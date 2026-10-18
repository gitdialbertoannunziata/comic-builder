/**
 * Chi può usare il passaggio del server di sviluppo (vite.config.ts).
 *
 * Il passaggio inoltra richieste a ComfyUI e al motore locale, e un grafo di
 * ComfyUI con nodi personalizzati esegue codice: una pagina qualunque, aperta
 * nel browser mentre gira `pnpm dev`, non deve poterci arrivare con un form o
 * un `fetch` alla cieca. Passano solo le richieste della nostra pagina.
 */
type Headers = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

export function fromOurPage(headers: Headers): boolean {
  // I browser di adesso dicono da dove viene la richiesta: basta questo.
  const site = one(headers["sec-fetch-site"]);
  if (site !== undefined && site !== "same-origin" && site !== "none") return false;
  // Per gli altri, l'origine: un POST da un'altra pagina la porta sempre.
  const origin = one(headers.origin);
  if (origin === undefined) return true;
  const host = one(headers.host);
  return host !== undefined && (origin === `http://${host}` || origin === `https://${host}`);
}

/** Solo questa macchina, e una porta vera. */
export function loopbackHost(host: string): boolean {
  const match = /^(127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})$/.exec(host);
  if (!match) return false;
  const port = Number(match[2]);
  return port >= 1 && port <= 65535;
}
