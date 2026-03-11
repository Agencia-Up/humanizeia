import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Music2, ExternalLink, CheckCircle, Loader2, Unplug } from 'lucide-react';

export function TikTokAdsSettingsTab() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const { data: tiktokAccounts = [], refetch } = useQuery({
    queryKey: ['tiktok-accounts', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ad_accounts')
        .select('*')
        .eq('platform', 'tiktok')
        .eq('is_active', true);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const isConnected = tiktokAccounts.length > 0;

  const handleConnect = async () => {
    setLoading(true);
    try {
      const redirectUri = `${window.location.origin}/connect-accounts?tiktok_callback=true`;
      const { data, error } = await supabase.functions.invoke('tiktok-oauth', {
        body: { action: 'get_auth_url', redirect_uri: redirectUri },
      });

      if (error) throw error;
      if (data?.auth_url) {
        window.location.href = data.auth_url;
      } else {
        toast.error('TikTok App ID não configurado. Configure nas variáveis de ambiente.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao iniciar conexão TikTok');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      const { error } = await supabase
        .from('ad_accounts')
        .update({ is_active: false })
        .eq('platform', 'tiktok')
        .eq('user_id', user?.id);

      if (error) throw error;
      toast.success('TikTok Ads desconectado');
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-foreground/10 flex items-center justify-center">
                <Music2 className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg">TikTok Ads</CardTitle>
                <CardDescription>Conecte sua conta TikTok Business para importar campanhas e métricas</CardDescription>
              </div>
            </div>
            <Badge variant={isConnected ? 'default' : 'secondary'} className={isConnected ? 'bg-green-500/20 text-green-400 border-green-500/30' : ''}>
              {isConnected ? <><CheckCircle className="h-3 w-3 mr-1" /> Conectado</> : 'Desconectado'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isConnected ? (
            <>
              <div className="space-y-2">
                {tiktokAccounts.map((acc) => (
                  <div key={acc.id} className="flex items-center justify-between rounded-lg border border-border/50 p-3 bg-muted/30">
                    <div>
                      <p className="font-medium text-sm">{acc.account_name}</p>
                      <p className="text-xs text-muted-foreground">ID: {acc.account_id}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">Ativo</Badge>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={handleDisconnect} className="gap-2">
                <Unplug className="h-4 w-4" />
                Desconectar
              </Button>
            </>
          ) : (
            <>
              <Alert>
                <AlertDescription>
                  Para conectar, você precisa de uma conta TikTok Business com acesso à API de anúncios.
                </AlertDescription>
              </Alert>
              <Button onClick={handleConnect} disabled={loading} className="gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                Conectar TikTok Ads
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Métricas TikTok Disponíveis</CardTitle>
          <CardDescription>Métricas específicas da plataforma que são sincronizadas automaticamente</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[
              'Impressões', 'Cliques', 'CTR', 'CPC', 'CPM',
              'Conversões', 'ROAS', 'Video Views (2s)',
              'Video Views (6s)', 'Engagement Rate',
              'Profile Visits', 'Likes', 'Shares', 'Comments',
              'Custo por Resultado',
            ].map((metric) => (
              <div key={metric} className="flex items-center gap-2 rounded-md border border-border/40 px-3 py-2 text-xs bg-muted/20">
                <CheckCircle className="h-3 w-3 text-primary" />
                {metric}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
