import { afterEach, describe, expect, it } from "vitest";
import { english, formatUsd, getLanguage, setLanguage, subscribeLanguage, t, translate } from "./i18n.js";

afterEach(() => setLanguage("it"));

describe("interface language", () => {
  it("keeps every interpolation placeholder in the English catalog", () => {
    const placeholders = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort();
    for (const [source, translated] of Object.entries(english)) {
      expect(translated.trim(), source).not.toBe("");
      expect(placeholders(translated), source).toEqual(placeholders(source));
    }
  });

  it("translates English labels and preserves Italian", () => {
    expect(translate("Copione", "en")).toBe("Script");
    expect(translate("Copione", "it")).toBe("Copione");
  });

  it("formats costs in the selected language", () => {
    expect(formatUsd(0.04)).toBe("0,04 $");
    setLanguage("en");
    expect(formatUsd(0.04)).toBe("$0.04");
  });

  it("preserves unknown text and interpolated project content", () => {
    expect(translate("FLUX", "en")).toBe("FLUX");
    expect(translate("{0}: {1}", "en", ["Il faro", 3])).toBe("Il faro: 3");
    expect(translate("{0} {1}", "it", ["{1}"])).toBe("{1} {1}");
  });

  it("notifies subscribers only when the language changes", () => {
    let changes = 0;
    const unsubscribe = subscribeLanguage(() => changes++);
    setLanguage("en");
    setLanguage("en");
    expect(getLanguage()).toBe("en");
    expect(t("Salva")).toBe("Save");
    expect(changes).toBe(1);
    unsubscribe();
    setLanguage("it");
    expect(changes).toBe(1);
  });
});