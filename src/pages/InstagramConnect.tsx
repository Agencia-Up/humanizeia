import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, CheckCircle, XCircle, Loader2, ExternalLink, Eye, EyeOff,
  KeyRound, Hash, LogOut
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export default function InstagramConnect() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isConnecting, setIsConnecting] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [appId, setAppId] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [showAppId, setShowAppId] = useState(false);

  const { data: igAccount, refetch } = useQuery({
    queryKey: ['ig-publisher', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('connected_accounts' as any)
        .select('*')
        .eq('platform', 'instagram_publisher')
        .eq('user_id', user?.id)
        .maybeSingle();
      return data as unknown as { account_name: string; extra_data: any } | null;
    },
    enabled: !!user,
  });

  const handleOAuthConnect = async () => {
    setIsConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão expirada. Faça login novamente.');

      const { data, error } = await supabase.functions.invoke('instagram-publish-oauth', {
        body: { action: 'authorize', origin: window.location.origin },
      });

      if (error) {
        let realMsg = 'Erro ao conectar Instagram';
        try {
          const errBody = await (error as any).context?.json?.();
          realMsg = errBody?.error || errBody?.message || error.message || realMsg;
        } catch (_) {
          realMsg = error.message || realMsg;
        }
        throw new Error(realMsg);
      }
      if (data?.error) throw new Error(data.error);
      if (data?.auth_url) {
        window.location.href = data.auth_url;
      } else {
        setIsConnecting(false);
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao conectar Instagram');
      setIsConnecting(false);
    }
  };

  const handleConnectWithToken = async () => {
    if (!accessToken.trim()) return;
    setIsConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('instagram-publish-oauth', {
        body: {
          action: 'connect_with_token',
          access_token: accessToken.trim(),
          app_id: appId.trim() || undefined,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success('Instagram conectado com sucesso!');
      setAccessToken('');
      setAppId('');
      refetch();
    } catch (err: any) {
      toast.error(err.message || 'Token inválido ou expirado.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await supabase.functions.invoke('instagram-publish-oauth', {
          body: { action: 'disconnect' },
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
      }
      refetch();
      toast.success('Instagram Business desconectado');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao desconectar');
    }
  };

  const username = igAccount?.extra_data?.username;

  return (
    <MainLayout>
      <div className="space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/integrations')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Conectar Instagram Business</h1>
            <p className="text-muted-foreground text-sm">
              Publicar posts, reels e carrosséis no Instagram
            </p>
          </div>
        </div>

        {/* Status Card */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500/20 to-purple-500/20">
                  <span className="text-2xl">📸</span>
                </div>
                <div>
                  <CardTitle className="text-lg">Instagram Business</CardTitle>
                  <CardDescription>
                    Conecte sua conta para publicar automaticamente
                  </CardDescription>
                </div>
              </div>
              {igAccount ? (
                <Badge className="bg-success/20 text-success border-success/30">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Conectado
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <XCircle className="h-3 w-3 mr-1" />
                  Não conectado
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {igAccount ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-muted/50 p-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Conta:</span>
                    <span className="font-medium">
                      {username ? `@${username}` : igAccount.account_name || 'Instagram Business'}
                    </span>
                  </div>
                </div>
                <Button variant="destructive" size="sm" onClick={handleDisconnect}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Desconectar
                </Button>
              </div>
            ) : (
              <div className="space-y-5">
                {/* OAuth Button */}
                <Button
                  className="w-full h-12 text-base bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white"
                  onClick={handleOAuthConnect}
                  disabled={isConnecting}
                  size="lg"
                >
                  {isConnecting ? (
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  ) : (
                    <span className="mr-2 text-lg">📸</span>
                  )}
                  Login com Facebook / Instagram
                </Button>

                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <div className="h-px flex-1 bg-border" />
                  <span>ou conecte manualmente</span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                {/* Manual Token Fields */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ig-app-id" className="flex items-center gap-2">
                      <Hash className="h-4 w-4" />
                      App ID (ID do Aplicativo)
                    </Label>
                    <div className="relative">
                      <Input
                        id="ig-app-id"
                        type={showAppId ? 'text' : 'password'}
                        placeholder="Cole o ID do seu App Meta aqui..."
                        value={appId}
                        onChange={(e) => setAppId(e.target.value)}
                        disabled={isConnecting}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowAppId(!showAppId)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showAppId ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Encontre em <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">developers.facebook.com/apps</a> → Configurações → Básico
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ig-token" className="flex items-center gap-2">
                      <KeyRound className="h-4 w-4" />
                      Token de Usuário (Access Token)
                    </Label>
                    <div className="relative">
                      <Input
                        id="ig-token"
                        type={showToken ? 'text' : 'password'}
                        placeholder="Cole seu Access Token aqui..."
                        value={accessToken}
                        onChange={(e) => setAccessToken(e.target.value)}
                        disabled={isConnecting}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken(!showToken)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <Button
                    className="gradient-primary w-full"
                    onClick={handleConnectWithToken}
                    disabled={isConnecting || !accessToken.trim()}
                    size="lg"
                  >
                    {isConnecting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Conectar Instagram
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Guide */}
        {!igAccount && (
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg">📋 Como conectar</CardTitle>
              <CardDescription>
                Siga os passos abaixo para conectar sua conta Instagram Business.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-0">
              <div className="flex gap-4 pb-6 relative">
                <div className="flex flex-col items-center">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">1</div>
                  <div className="w-px flex-1 bg-border/50 mt-2" />
                </div>
                <div className="pt-1 pb-2">
                  <p className="font-medium text-sm">Crie ou acesse seu App no Meta for Developers</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Vá em <strong>Configurações → Básico</strong> e copie o <strong>ID do Aplicativo</strong>.
                  </p>
                  <Button variant="link" className="p-0 h-auto mt-1 text-xs" asChild>
                    <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                      Abrir Meta for Developers <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                </div>
              </div>
              <div className="flex gap-4 pb-6 relative">
                <div className="flex flex-col items-center">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">2</div>
                  <div className="w-px flex-1 bg-border/50 mt-2" />
                </div>
                <div className="pt-1 pb-2">
                  <p className="font-medium text-sm">Gere o Token de Usuário</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    No <strong>Graph API Explorer</strong>, selecione seu app e marque as permissões: <code className="bg-muted px-1 rounded text-xs">instagram_basic</code>, <code className="bg-muted px-1 rounded text-xs">instagram_content_publish</code>, <code className="bg-muted px-1 rounded text-xs">pages_show_list</code>, <code className="bg-muted px-1 rounded text-xs">pages_read_engagement</code>
                  </p>
                  <Button variant="link" className="p-0 h-auto mt-1 text-xs" asChild>
                    <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                      Abrir Graph API Explorer <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                </div>
              </div>
              <div className="flex gap-4 relative">
                <div className="flex flex-col items-center">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">3</div>
                </div>
                <div className="pt-1">
                  <p className="font-medium text-sm">Cole o App ID e o Token acima</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Sua conta Instagram Business será detectada automaticamente.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-600 dark:text-amber-400">
          ⚠️ Sua conta Instagram precisa ser do tipo Business ou Creator e estar conectada a uma Página do Facebook.
        </div>
      </div>
    </MainLayout>
  );
}
