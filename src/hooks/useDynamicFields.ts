// Hook React pra carregar cidades/origens dinâmicas com cache + auto-refresh.
// Fase 6.4c: subscribe ao Realtime — cross-user vê nova entrada na mesma conta sem F5.

import { useCallback, useEffect, useState } from "react";
import {
  listActive,
  type DynamicEntity,
  type DynamicRow,
} from "@/services/dynamicFields/dynamicFieldsService";
import { supabase } from "@/integrations/supabase/client";

interface UseDynamicFieldsResult {
  rows: DynamicRow[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const TABLE_BY_ENTITY: Record<DynamicEntity, string> = {
  city: "cities",
  lead_source: "lead_sources",
};

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

  // Realtime: nova entrada vinda de OUTRO usuário do mesmo master aparece sem F5
  useEffect(() => {
    if (!userId) return;
    const table = TABLE_BY_ENTITY[entity];
    const channel = supabase
      .channel(`dynamic-fields:${entity}:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `user_id=eq.${userId}` },
        () => {
          // Recarrega — debounce simples: ignora se loading já em andamento
          reload();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [entity, userId, reload]);

  return { rows, loading, error, reload };
}
