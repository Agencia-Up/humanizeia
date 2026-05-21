// Hook React pra carregar cidades/origens dinâmicas com cache + auto-refresh.

import { useCallback, useEffect, useState } from "react";
import {
  listActive,
  type DynamicEntity,
  type DynamicRow,
} from "@/services/dynamicFields/dynamicFieldsService";

interface UseDynamicFieldsResult {
  rows: DynamicRow[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useDynamicFields(
  entity: DynamicEntity,
  userId: string | null | undefined
): UseDynamicFieldsResult {
  const [rows, setRows] = useState<DynamicRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listActive(entity, userId);
      setRows(data);
    } catch (err: any) {
      setError(err?.message || "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [entity, userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { rows, loading, error, reload };
}
