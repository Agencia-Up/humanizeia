// Hook que retorna contagem de pendentes pra badge no sidebar
// (cities + lead_sources combinados). Refetch leve a cada 60s.

import { useEffect, useState } from "react";
import { countPending } from "@/services/dynamicFields/dynamicFieldsService";

export function useDynamicFieldsBadge(userId: string | null | undefined): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!userId) {
      setCount(0);
      return;
    }
    let cancelled = false;
    const fetch = async () => {
      try {
        const n = await countPending(userId);
        if (!cancelled) setCount(n);
      } catch {
        // silencia — badge é nice-to-have
      }
    };
    fetch();
    const interval = setInterval(fetch, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [userId]);

  return count;
}
