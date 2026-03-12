import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface WhatsAppConfig {
  id: string;
  user_id: string;
  api_url: string;
  instance_name: string;
  phone_number: string;
  is_active: boolean;
  send_daily_report: boolean;
  report_time: string;
}

export function useWhatsAppConfig() {
  const { toast } = useToast();
  const [config, setConfig] = useState<WhatsAppConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.user) {
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('whatsapp_config')
        .select('id, user_id, api_url, instance_name, phone_number, is_active, send_daily_report, report_time')
        .eq('user_id', session.session.user.id)
        .maybeSingle();

      if (error) throw error;
      setConfig(data as WhatsAppConfig | null);
    } catch (err) {
      console.error('Error fetching WhatsApp config:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const saveConfig = async (values: {
    api_url: string;
    api_key?: string;
    instance_name: string;
    phone_number: string;
    send_daily_report: boolean;
    report_time: string;
  }) => {
    setIsSaving(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.user) throw new Error('Não autenticado');

      const userId = session.session.user.id;
      const payload = {
        ...values,
        user_id: userId,
        is_active: true,
      };

      if (config) {
        const { error } = await supabase
          .from('whatsapp_config')
          .update(payload)
          .eq('id', config.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('whatsapp_config')
          .insert(payload);
        if (error) throw error;
      }

      toast({ title: 'Configuração salva com sucesso!' });
      await fetchConfig();
    } catch (err: any) {
      console.error('Error saving WhatsApp config:', err);
      toast({ title: 'Erro ao salvar', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const testConnection = async () => {
    setIsTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-whatsapp-report', {
        body: { action: 'test' },
      });

      if (error) throw error;
      if (data?.success) {
        toast({ title: 'Conexão OK!', description: 'Mensagem de teste enviada com sucesso.' });
      } else {
        throw new Error(data?.error || 'Falha ao enviar mensagem de teste');
      }
    } catch (err: any) {
      console.error('Error testing WhatsApp:', err);
      toast({ title: 'Erro no teste', description: err.message, variant: 'destructive' });
    } finally {
      setIsTesting(false);
    }
  };

  const disconnect = async () => {
    try {
      if (!config) return;
      const { error } = await supabase
        .from('whatsapp_config')
        .delete()
        .eq('id', config.id);
      if (error) throw error;
      setConfig(null);
      toast({ title: 'WhatsApp desconectado' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  return {
    config,
    isLoading,
    isSaving,
    isTesting,
    saveConfig,
    testConnection,
    disconnect,
  };
}
