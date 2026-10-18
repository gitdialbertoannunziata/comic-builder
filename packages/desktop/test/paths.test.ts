import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { within } from "../src/paths.js";

describe("Le cartelle concesse", () => {
  let base: string;
  let project: string;
  let outside: string;
  beforeEach(async () => {
    base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "percorsi-")));
    project = path.join(base, "progetto");
    outside = path.join(base, "fuori");
    await fs.mkdir(path.join(project, "characters"), { recursive: true });
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "segreto.txt"), "no");
  });
  afterEach(() => fs.rm(base, { recursive: true, force: true }));

  it("dentro sì, anche un file che non esiste ancora", async () => {
    expect(await within(path.join(project, "characters", "nuovo", "a.png"), [project])).toBe(path.join(project, "characters", "nuovo", "a.png"));
    expect(await within(project, [project])).toBe(project);
  });

  it("«..» e una cartella accanto col nome che comincia uguale restano fuori", async () => {
    await expect(within(path.join(project, "..", "fuori", "segreto.txt"), [project])).rejects.toThrow(/fuori dalle cartelle/);
    await fs.mkdir(`${project}-bis`);
    await expect(within(path.join(`${project}-bis`, "x"), [project])).rejects.toThrow(/fuori dalle cartelle/);
  });

  it("un collegamento dentro il progetto che porta fuori non passa", async () => {
    // «junction» su Windows non chiede permessi da amministratore; altrove il tipo si ignora.
    await fs.symlink(outside, path.join(project, "scorciatoia"), "junction");
    await expect(within(path.join(project, "scorciatoia", "segreto.txt"), [project])).rejects.toThrow(/fuori dalle cartelle/);
    await expect(within(path.join(project, "scorciatoia", "nuovo.txt"), [project])).rejects.toThrow(/fuori dalle cartelle/);
  });
});
