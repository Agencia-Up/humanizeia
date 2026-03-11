import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';

export interface CopyFormula {
  id: string;
  name: string;
  full_name: string;
  description: string;
  example: string;
  is_default: boolean;
  user_id: string;
  created_at: string;
}

export function useCopyFormulas() {
  const [formulas, setFormulas] = useState<CopyFormula[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { toast } = useToast();

  const fetchFormulas = useCallback(async () => {
    setLoading(true);
    // Fetch default formulas (visible to all) + user's own formulas
    const { data, error } = await supabase
      .from('copy_formulas')
      .select('*')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching formulas:', error);
    } else {
      setFormulas((data as CopyFormula[]) || []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchFormulas();
  }, [fetchFormulas]);

  const addFormula = useCallback(async (formula: {
    name: string;
    full_name: string;
    description: string;
    example: string;
  }) => {
    if (!user) {
      toast({ title: 'Faça login para salvar fórmulas', variant: 'destructive' });
      return;
    }
    const { error } = await supabase
      .from('copy_formulas')
      .insert({
        ...formula,
        user_id: user.id,
      });

    if (error) {
      toast({ title: 'Erro ao salvar fórmula', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '✅ Fórmula salva!' });
      fetchFormulas();
    }
  }, [user, toast, fetchFormulas]);

  const deleteFormula = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('copy_formulas')
      .delete()
      .eq('id', id);

    if (error) {
      toast({ title: 'Erro ao excluir', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Fórmula excluída' });
      fetchFormulas();
    }
  }, [toast, fetchFormulas]);

  const updateFormula = useCallback(async (id: string, updates: Partial<Pick<CopyFormula, 'name' | 'full_name' | 'description' | 'example'>>) => {
    const { error } = await supabase
      .from('copy_formulas')
      .update(updates)
      .eq('id', id);

    if (error) {
      toast({ title: 'Erro ao atualizar', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '✅ Fórmula atualizada!' });
      fetchFormulas();
    }
  }, [toast, fetchFormulas]);

  return { formulas, loading, addFormula, deleteFormula, updateFormula, refetch: fetchFormulas };
}
