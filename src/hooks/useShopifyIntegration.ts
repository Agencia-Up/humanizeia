import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ShopifyIntegration {
  id: string;
  user_id: string;
  platform: string;
  store_url: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  sync_status: string;
  metadata: Record<string, any>;
}

export function useShopifyIntegration() {
  const [integration, setIntegration] = useState<ShopifyIntegration | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const { toast } = useToast();

  const fetchStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setIntegration(null);
        return;
      }
      const { data, error } = await supabase.functions.invoke('shopify-integration', {
        body: { action: 'get_status' }
      });

      if (error) throw error;
      setIntegration(data?.data || null);
    } catch (error) {
      console.error('Error fetching Shopify status:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const saveCredentials = async (apiKey: string, storeUrl: string) => {
    try {
      setIsSaving(true);
      const { data, error } = await supabase.functions.invoke('shopify-integration', {
        body: { action: 'save_credentials', apiKey, storeUrl }
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: 'Credenciais salvas!',
          description: 'Clique em "Testar Conexão" para verificar.',
        });
        await fetchStatus();
        return true;
      } else {
        throw new Error(data?.error || 'Erro desconhecido');
      }
    } catch (error: any) {
      toast({
        title: 'Erro ao salvar',
        description: error.message,
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const testConnection = async () => {
    try {
      setIsTesting(true);
      const { data, error } = await supabase.functions.invoke('shopify-integration', {
        body: { action: 'test_connection' }
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: 'Conexão bem-sucedida! ✅',
          description: `Conectado à loja: ${data.shop?.name || 'Shopify'}`,
        });
        await fetchStatus();
        return true;
      } else {
        toast({
          title: 'Falha na conexão',
          description: data?.error || 'Verifique suas credenciais',
          variant: 'destructive',
        });
        return false;
      }
    } catch (error: any) {
      toast({
        title: 'Erro ao testar conexão',
        description: error.message,
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsTesting(false);
    }
  };

  const syncOrders = async () => {
    try {
      setIsSyncing(true);
      const { data, error } = await supabase.functions.invoke('shopify-integration', {
        body: { action: 'sync_orders' }
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: 'Sincronização concluída!',
          description: `${data.synced} pedidos sincronizados.`,
        });
        await fetchStatus();
        return true;
      } else {
        throw new Error(data?.error || 'Erro na sincronização');
      }
    } catch (error: any) {
      toast({
        title: 'Erro na sincronização',
        description: error.message,
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsSyncing(false);
    }
  };

  const disconnect = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('shopify-integration', {
        body: { action: 'disconnect' }
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: 'Desconectado',
          description: 'Integração com Shopify removida.',
        });
        await fetchStatus();
        return true;
      }
      return false;
    } catch (error: any) {
      toast({
        title: 'Erro ao desconectar',
        description: error.message,
        variant: 'destructive',
      });
      return false;
    }
  };

  return {
    integration,
    isLoading,
    isSaving,
    isTesting,
    isSyncing,
    saveCredentials,
    testConnection,
    syncOrders,
    disconnect,
    refetch: fetchStatus,
  };
}
