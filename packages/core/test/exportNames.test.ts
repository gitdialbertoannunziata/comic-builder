import { describe, expect, it } from "vitest";
import { pageFileName, pageFileNames } from "../src/platform/exportNames.js";
import type { Page } from "../src/schema/page.js";

function page(id: string, order: number): Page {
  return { id, order } as Page;
}

describe("Nomi dei file esportati (Appendice C, regola 1)", () => {
  it("prefissa con l'ordine di lettura, non con l'ordine alfabetico", () => {
    expect(pageFileName(page("ep001-p003", 3), "png")).toBe("003-ep001-p003.png");
  });

  it("un capitolo lungo resta ordinabile in qualunque cartella", () => {
    const pages = [1, 2, 9, 10, 11, 12].map((n) => page(`ep001-p${n}`, n));
    const names = pageFileNames(pages, "png");

    expect(names).toEqual([
      "001-ep001-p1.png",
      "002-ep001-p2.png",
      "009-ep001-p9.png",
      "010-ep001-p10.png",
      "011-ep001-p11.png",
      "012-ep001-p12.png",
    ]);
    // Il punto della regola: ordinati come stringhe restano in ordine di lettura.
    expect([...names].sort()).toEqual(names);
  });

  it("allarga il prefisso oltre le 999 pagine, invece di rompere l'ordinamento", () => {
    const pages = [1, 1000].map((n) => page(`p${n}`, n));
    const names = pageFileNames(pages, "png");
    expect(names).toEqual(["0001-p1.png", "1000-p1000.png"]);
    expect([...names].sort()).toEqual(names);
  });

  it("usa `order` e non la posizione nell'array: le due cose divergono quando si riordina", () => {
    // Pagine passate in ordine sparso, come capita dopo un inserimento.
    const pages = [page("b", 2), page("a", 1)];
    expect(pageFileNames(pages, "svg")).toEqual(["002-b.svg", "001-a.svg"]);
  });
});
