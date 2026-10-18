import { t } from "./i18n.js";
import { useEffect, useRef, useState } from "react";
import { scheduleGeneration, type GenerationKind, type GenerationOptions } from "./generationScheduler.js";
import { localModelIdentity } from "./platform/localModels.js";

export type GenerationScope = ReturnType<typeof useGeneration>;

export function useGeneration(identity: unknown, projectId = "") {
  const current = useRef({ identity, projectId });
  if (current.current.identity !== identity || current.current.projectId !== projectId) current.current = { identity, projectId };
  const mounted = useRef(true);
  const jobs = useRef(new Map<AbortController, { token: typeof current.current; phase: "queued" | "running" }>());
  const [counts, setCounts] = useState({ queued: 0, running: 0 });
  const renderToken = current.current;
  function publish() {
    if (!mounted.current) return;
    const pending = [...jobs.current.values()].filter((job) => job.token === current.current);
    setCounts({ queued: pending.filter((job) => job.phase === "queued").length, running: pending.filter((job) => job.phase === "running").length });
  }
  useEffect(() => {
    const token = current.current;
    mounted.current = true;
    publish();
    return () => {
      mounted.current = false;
      for (const [controller, job] of jobs.current) {
        if (job.token === token) controller.abort();
      }
    };
  }, [identity, projectId]);

  async function schedule<Result>(
    service: string,
    kind: GenerationKind,
    label: string,
    task: (signal: AbortSignal, isCurrent: () => boolean) => Promise<Result>,
    valid: () => boolean = () => true,
    spend?: GenerationOptions["spend"],
  ): Promise<Result> {
    const token = current.current;
    const model = service === "local" ? localModelIdentity(kind) : null;
    const abort = new AbortController();
    jobs.current.set(abort, { token, phase: "queued" });
    const isCurrent = () => mounted.current && current.current === token && !abort.signal.aborted;
    publish();
    try {
      const result = await scheduleGeneration(service, kind, label, async (signal) => {
        jobs.current.set(abort, { token, phase: "running" });
        publish();
        const cancelled = () => new DOMException(t("Generazione annullata."), "AbortError");
        let result: Result;
        try {
          result = await task(signal, () => isCurrent() && !signal.aborted);
        } catch (error) {
          // Il servizio fermato risponde col suo errore di annullamento: per chi guarda è sempre lo stesso.
          if (!isCurrent() || signal.aborted) throw cancelled();
          throw error;
        }
        if (!isCurrent() || signal.aborted) throw cancelled();
        return result;
      }, { signal: abort.signal, isValid: () => isCurrent() && valid() && (model === null || model === localModelIdentity(kind)), ...(spend ? { spend } : {}) });
      return result;
    } finally {
      jobs.current.delete(abort);
      publish();
    }
  }

  const phase = counts.running > 0 ? "running" : counts.queued > 0 ? "queued" : null;
  return {
    schedule, phase, ...counts,
    cancel: () => {
      for (const [controller, job] of jobs.current) {
        if (job.token === renderToken && job.phase === "running") controller.abort();
      }
    },
    isCurrent: () => mounted.current && current.current === renderToken,
  };
}