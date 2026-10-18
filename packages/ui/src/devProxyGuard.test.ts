import { describe, expect, it } from "vitest";
import { fromOurPage, loopbackHost } from "./devProxyGuard.js";

describe("Passaggio del server di sviluppo", () => {
  const host = "localhost:5173";

  it("passa la nostra pagina, non le altre", () => {
    expect(fromOurPage({ host, "sec-fetch-site": "same-origin", origin: "http://localhost:5173" })).toBe(true);
    expect(fromOurPage({ host })).toBe(true);
    expect(fromOurPage({ host, "sec-fetch-site": "cross-site", origin: "https://esempio.it" })).toBe(false);
    // Un'altra porta della stessa macchina è un'altra origine.
    expect(fromOurPage({ host, "sec-fetch-site": "same-site", origin: "http://localhost:3000" })).toBe(false);
    // Un browser che non manda Sec-Fetch-*: decide l'origine.
    expect(fromOurPage({ host, origin: "https://esempio.it" })).toBe(false);
    expect(fromOurPage({ host, origin: "http://localhost:5173" })).toBe(true);
  });

  it("verso questa macchina, su una porta vera", () => {
    expect(loopbackHost("127.0.0.1:8188")).toBe(true);
    expect(loopbackHost("[::1]:1234")).toBe(true);
    expect(loopbackHost("127.0.0.1:99999")).toBe(false);
    expect(loopbackHost("127.0.0.1:0")).toBe(false);
    expect(loopbackHost("esempio.it:80")).toBe(false);
    expect(loopbackHost("localhost.esempio.it:80")).toBe(false);
  });
});
