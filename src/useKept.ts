// State that survives leaving the tab (to read a rule) and coming back. Lost when the app closes.
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

const kept = new Map<string, unknown>();

export function useKept<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, set] = useState<T>(() => (kept.has(key) ? (kept.get(key) as T) : initial));
  useEffect(() => { kept.set(key, value); }, [key, value]);
  return [value, set];
}
