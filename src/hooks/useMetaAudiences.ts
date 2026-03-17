import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export function useMetaAudiences() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Local audiences from DB
  const audiencesQuery = useQuery({
    queryKey: ['audiences', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audiences')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Fetch remote custom audiences from Meta
  const fetchRemoteAudiences = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke('meta-api', {
      body: {
        endpoint: 'act_{ad_account_id}/customaudiences',
        params: { fields: 'id,name,approximate_count,subtype,time_created,description' },
      },
    });
    if (error) throw error;
    return data?.data || [];
  }, []);

  // Create custom audience on Meta
  const createCustomAudience = useMutation({
    mutationFn: async (audience: {
      name: string;
      description?: string;
      subtype: string;
      customer_file_source?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('meta-api', {
        body: {
          endpoint: 'act_{ad_account_id}/customaudiences',
          method: 'POST',
          body: {
            name: audience.name,
            description: audience.description || '',
            subtype: audience.subtype,
            customer_file_source: audience.customer_file_source || 'USER_PROVIDED_ONLY',
          },
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Save to local DB
      await supabase.from('audiences').insert({
        user_id: user!.id,
        name: audience.name,
        description: audience.description,
        external_id: data.id,
        platform: 'meta',
        audience_type: audience.subtype === 'LOOKALIKE' ? 'lookalike' : 'custom',
        source: 'meta_api',
      });

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audiences'] });
      toast.success('Público criado com sucesso no Meta Ads');
    },
    onError: (err: any) => toast.error(`Erro ao criar público: ${err.message}`),
  });

  // Create lookalike audience
  const createLookalikeAudience = useMutation({
    mutationFn: async (params: {
      name: string;
      origin_audience_id: string;
      target_countries: string[];
      ratio: number; // 0.01 to 0.20
    }) => {
      const { data, error } = await supabase.functions.invoke('meta-api', {
        body: {
          endpoint: 'act_{ad_account_id}/customaudiences',
          method: 'POST',
          body: {
            name: params.name,
            subtype: 'LOOKALIKE',
            origin_audience_id: params.origin_audience_id,
            lookalike_spec: JSON.stringify({
              type: 'similarity',
              country: params.target_countries.join(','),
              ratio: params.ratio,
            }),
          },
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      await supabase.from('audiences').insert({
        user_id: user!.id,
        name: params.name,
        external_id: data.id,
        platform: 'meta',
        audience_type: 'lookalike',
        source: 'meta_api',
        targeting_config: {
          origin_audience_id: params.origin_audience_id,
          countries: params.target_countries,
          ratio: params.ratio,
        },
      });

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audiences'] });
      toast.success('Público Lookalike criado com sucesso');
    },
    onError: (err: any) => toast.error(`Erro ao criar lookalike: ${err.message}`),
  });

  // Delete audience
  const deleteAudience = useMutation({
    mutationFn: async ({ id, externalId }: { id: string; externalId?: string }) => {
      if (externalId) {
        await supabase.functions.invoke('meta-api', {
          body: { endpoint: externalId, method: 'DELETE' },
        });
      }
      const { error } = await supabase.from('audiences').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audiences'] });
      toast.success('Público removido');
    },
  });

  return {
    audiences: audiencesQuery.data || [],
    isLoading: audiencesQuery.isLoading,
    fetchRemoteAudiences,
    createCustomAudience,
    createLookalikeAudience,
    deleteAudience,
  };
}
