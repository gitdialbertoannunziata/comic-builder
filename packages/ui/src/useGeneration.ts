import { t } from "./i18n.js";
import { useEffect, useRef, useState } from "react";
import { scheduleGeneration, type GenerationKind } from "./generationScheduler.js";
import { localModelIdentity } from "./platform/localModels.js";

export function useGeneration(identity: unknown, projectId = "") {
  const current = useRef({ identity, projectId });
  if (current.current.identity !== identity || current.current.projectId !== projectId) current.current = { identity, projectId };
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<"queued" | "running" | null>(null);
  const renderToken = current.current;
  useEffect(() => {
    mounted.current = true;
    controller.current = null;
    setPhase(null);
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, [identity, projectId]);

  async function schedule<Result>(service: string, kind: GenerationKind, label: string, task: (signal: AbortSignal, isCurrent: () => boolean) => Promise<Result>, valid: () => boolean = () => true): Promise<Result> {
    if (controller.current) throw new Error(t("Questo lavoro e' gia' in coda."));
    const token = current.current;
    const model = service === "local" ? localModelIdentity(kind) : null;
    const abort = new AbortController();
    controller.current = abort;
    const isCurrent = () => mounted.current && current.current === token && !abort.signal.aborted;
    setPhase("queued");
    try {
      const result = await scheduleGeneration(service, kind, label, async (signal) => {
        setPhase("running");
        const result = await task(signal, () => isCurrent() && !signal.aborted);
        if (!isCurrent() || signal.aborted) throw new DOMException(t("Generazione annullata."), "AbortError");
        return result;
      }, { signal: abort.signal, isValid: () => isCurrent() && valid() && (model === null || model === localModelIdentity(kind)) });
      return result;
    } finally {
      if (controller.current === abort) controller.current = null;
      if (mounted.current && current.current === token) setPhase(null);
    }
  }

  return { schedule, phase, cancel: () => controller.current?.abort(), isCurrent: () => mounted.current && current.current === renderToken };
}