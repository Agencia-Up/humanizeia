import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * A useState replacement that persists to localStorage.
 * Handles quota errors gracefully (falls back to in-memory only).
 * Debounces writes to avoid performance issues with large data (e.g. base64 images).
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  debounceMs = 300,
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        return JSON.parse(stored) as T;
      }
    } catch {
      // corrupted or missing — use default
    }
    return defaultValue;
  });

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced write to localStorage
  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // quota exceeded — silently ignore, state still works in-memory
        console.warn(`[usePersistedState] Could not persist "${key}" — storage quota may be exceeded.`);
      }
    }, debounceMs);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [key, value, debounceMs]);

  // Clear this key from storage
  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch { /* ignore */ }
  }, [key]);

  return [value, setValue, clear];
}
