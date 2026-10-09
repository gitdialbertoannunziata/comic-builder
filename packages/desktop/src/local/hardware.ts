import { app } from "electron";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import type { Hardware } from "./catalog.js";

/**
 * Cosa c'è in questo computer, per consigliare cosa installare. Quello che
 * si può sapere senza chiedere niente all'utente: sistema, RAM, la GPU che
 * Chromium vede e, su NVIDIA, la sua memoria (da `nvidia-smi`, che il driver
 * installa). Su Windows e Linux con AMD o Intel la memoria della GPU non si
 * legge in modo affidabile: la procedura guidata lo dice e fa scegliere.
 */

const VENDORS: Record<number, NonNullable<Hardware["gpu"]>["vendor"]> = { 0x10de: "nvidia", 0x1002: "amd", 0x8086: "intel", 0x106b: "apple" };

function run(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 4000, windowsHide: true }, (error, stdout) => resolve(error ? null : stdout));
  });
}

async function gpu(): Promise<Hardware["gpu"]> {
  if (process.platform === "darwin" && process.arch === "arm64") return { name: "Apple Silicon", vendor: "apple", vramGB: null };
  let found: Hardware["gpu"] = null;
  try {
    const info = (await app.getGPUInfo("basic")) as { gpuDevice?: Array<{ vendorId: number; deviceString?: string; active?: boolean }> };
    // La GPU discreta, se c'è, è quella che conta: NVIDIA o AMD prima della Intel integrata.
    const devices = (info.gpuDevice ?? []).filter((d) => d.vendorId && VENDORS[d.vendorId] !== undefined);
    const best = devices.find((d) => VENDORS[d.vendorId] === "nvidia") ?? devices.find((d) => VENDORS[d.vendorId] === "amd") ?? devices.find((d) => d.active) ?? devices[0];
    if (best) found = { name: best.deviceString || VENDORS[best.vendorId]!, vendor: VENDORS[best.vendorId]!, vramGB: null };
  } catch {
    // Senza informazioni sulla GPU si prova comunque nvidia-smi.
  }
  const smi = await run("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
  const line = smi?.split("\n").find((l) => l.trim());
  if (line) {
    const [name, mib] = line.split(",").map((s) => s.trim());
    const vramGB = Number(mib) / 1024;
    return { name: name || found?.name || "NVIDIA", vendor: "nvidia", vramGB: Number.isFinite(vramGB) ? Math.round(vramGB * 10) / 10 : null };
  }
  return found;
}

export async function detectHardware(modelsDir: string): Promise<Hardware> {
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
  let freeDiskGB: number | null = null;
  try {
    await fs.mkdir(modelsDir, { recursive: true });
    const stat = await fs.statfs(modelsDir);
    freeDiskGB = Math.round(((stat.bavail * stat.bsize) / 1e9) * 10) / 10;
  } catch {
    freeDiskGB = null;
  }
  return {
    platform: process.platform,
    arch: process.arch,
    ramGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    gpu: await gpu(),
    glibc: process.platform === "linux" ? (report?.header?.glibcVersionRuntime ?? null) : null,
    freeDiskGB,
  };
}
