import { useEffect, useState } from "react";
import { loadPreference, savePreference } from "./platform/session.js";

/**
 * Uno stato che sopravvive a un F5 (localStorage). Solo preferenze
 * dell'interfaccia: mai chiavi API, che digitate nella UI non si salvano.
 */
export function usePreference<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => loadPreference(key, initial));
  useEffect(() => savePreference(key, value), [key, value]);
  return [value, setValue];
}
