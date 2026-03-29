import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  CheckCircle, XCircle, Loader2, ExternalLink, ShieldCheck,
  Music2, LineChart, Tag, Briefcase, Clock,
} from 'lucide-react';
import { useMetaConnection } from '@/hooks/useMetaConnection';
import { useGoogleAdsConnection } from '@/hooks/useGoogleAdsConnection';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/* ------------------------------------------------------------------ */
/*  Platform definitions                                                */
/* ------------------------------------------------------------------ */

interface PlatformStep {
  title: string;
  description: string;
}

interface PlatformDef {
  id: string;
  name: string;
  icon: React.ReactNode;
  iconBg: string;
  description: string;
  status: 'available' | 'coming_soon';
  steps: PlatformStep[];
  warning?: string;
}

function MetaIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function GoogleIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function TikTokIcon() {
  return <Music2 className="h-6 w-6" />;
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="url(#ig-gradient)">
      <defs>
        <linearGradient id="ig-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f09433" />
          <stop offset="25%" stopColor="#e6683c" />
          <stop offset="50%" stopColor="#dc2743" />
          <stop offset="75%" stopColor="#cc2366" />
          <stop offset="100%" stopColor="#bc1888" />
        </linearGradient>
      </defs>
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
    </svg>
  );
}

const PLATFORMS: PlatformDef[] = [
  {
    id: 'meta',
    name: 'Meta Ads',
    icon: <MetaIcon />,
    iconBg: 'bg-blue-500/15 text-blue-500',
    description: 'Facebook, Instagram e Messenger Ads',
    status: 'available',
    steps: [
      { title: 'Clique em "Conectar"', description: 'Você será redirecionado para a página de login do Facebook.' },
      { title: 'Faça login na sua conta', description: 'Use sua conta pessoal ou de administrador do Facebook.' },
      { title: 'Autorize o acesso', description: 'O LogosIA solicitará permissão para ler dados de campanhas.' },
      { title: 'Selecione a conta de anúncios', description: 'Escolha qual conta deseja gerenciar na plataforma.' },
      { title: 'Pronto!', description: 'Suas campanhas e métricas serão importadas automaticamente.' },
    ],
    warning: 'Você precisa ser administrador da conta de anúncios no Facebook.',
  },
  {
    id: 'instagram_publisher',
    name: 'Instagram Business',
    icon: <InstagramIcon />,
    iconBg: 'bg-pink-500/15',
    description: 'Publicar posts, reels e carrosséis no Instagram',
    status: 'available' as const,
    steps: [
      { title: 'Clique em "Conectar"', description: 'Você será redirecionado para o Facebook.' },
      { title: 'Faça login no Facebook', description: 'Use a conta pessoal que gerencia a Página.' },
      { title: 'Autorize o acesso', description: 'Permita a publicação no Instagram Business.' },
      { title: 'Página conectada ao Instagram', description: 'Sua Página do Facebook precisa estar vinculada a uma conta Instagram Business.' },
      { title: 'Pronto!', description: 'Davi pode publicar automaticamente no seu Instagram.' },
    ],
    warning: 'Sua conta Instagram precisa ser do tipo Business ou Creator e estar conectada a uma Página do Facebook.',
  },
  {
    id: 'google_ads',
    name: 'Google Ads',
    icon: <GoogleIcon />,
    iconBg: 'bg-red-500/15 text-red-500',
    description: 'Pesquisa, Display, YouTube e Shopping',
    status: 'available',
    steps: [
      { title: 'Clique em "Conectar"', description: 'Um botão simples — sem precisar instalar nada no seu computador.' },
      { title: 'Faça login no Google', description: 'Use o mesmo e-mail e senha que você já usa no Google Ads. Nenhum código ou API é necessário.' },
      { title: 'Permita o acesso (clique em "Permitir")', description: 'O Google vai perguntar se o LogosIA pode ver seus dados de anúncios. Basta clicar "Permitir". Suas senhas nunca são compartilhadas.' },
      { title: 'Escolha sua conta de anúncios', description: 'Se você tem mais de uma conta no Google Ads, é só clicar na que deseja usar.' },
      { title: '✅ Pronto! Tudo conectado', description: 'Suas campanhas, gastos e resultados aparecerão automaticamente no seu Dashboard.' },
    ],
    warning: 'Você precisa ter uma conta ativa no Google Ads. Se não sabe qual é seu login, é o mesmo e-mail que você usa para acessar ads.google.com.',
  },
  {
    id: 'google_analytics',
    name: 'Google Analytics',
    icon: <LineChart className="h-6 w-6" />,
    iconBg: 'bg-orange-500/15 text-orange-500',
    description: 'Dados de tráfego, conversões e audiência',
    status: 'coming_soon',
    steps: [
      { title: 'Clique em "Conectar"', description: 'Você será redirecionado para a página de login do Google.' },
      { title: 'Autorize o acesso ao Analytics', description: 'O Google solicitará permissão para ler dados do GA4.' },
      { title: 'Selecione a propriedade', description: 'Escolha o site/app que deseja monitorar.' },
      { title: 'Pronto!', description: 'Dados de tráfego, conversões e audiência serão sincronizados.' },
    ],
  },
  {
    id: 'google_gtm',
    name: 'Tag Manager',
    icon: <Tag className="h-6 w-6" />,
    iconBg: 'bg-cyan-500/15 text-cyan-500',
    description: 'Gerencie tags e pixels de rastreamento',
    status: 'coming_soon',
    steps: [
      { title: 'Clique em "Conectar"', description: 'Você será redirecionado para a página de login do Google.' },
      { title: 'Autorize o acesso ao GTM', description: 'Permita a leitura dos seus containers e tags.' },
      { title: 'Selecione o container', description: 'Escolha o container GTM do seu site.' },
      { title: 'Pronto!', description: 'Visualize e gerencie tags diretamente pela plataforma.' },
    ],
  },
  {
    id: 'tiktok',
    name: 'TikTok Ads',
    icon: <TikTokIcon />,
    iconBg: 'bg-foreground/10 text-foreground',
    description: 'Anúncios em vídeo para audiência jovem',
    status: 'available',
    steps: [
      { title: 'Clique em "Conectar"', description: 'Você será redirecionado para o TikTok Business.' },
      { title: 'Faça login na sua conta', description: 'Use sua conta TikTok Business ou de anunciante.' },
      { title: 'Autorize o acesso', description: 'O LogosIA solicitará permissão para ler campanhas.' },
      { title: 'Selecione a conta de anúncios', description: 'Escolha o Advertiser ID que deseja gerenciar.' },
      { title: 'Pronto!', description: 'Suas campanhas TikTok serão importadas automaticamente.' },
    ],
    warning: 'Você precisa de uma conta TikTok Business com acesso à API de anúncios.',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn Ads',
    icon: <Briefcase className="h-6 w-6" />,
    iconBg: 'bg-blue-700/15 text-blue-700',
    description: 'Anúncios B2B para profissionais e empresas',
    status: 'available',
    steps: [
      { title: 'Clique em "Conectar"', description: 'Você será redirecionado para o LinkedIn.' },
      { title: 'Faça login na sua conta', description: 'Use seu perfil pessoal ou conta de administrador.' },
      { title: 'Autorize o acesso', description: 'O LogosIA solicitará permissão para gerenciar anúncios.' },
      { title: 'Selecione a página da empresa', description: 'Escolha a Company Page que deseja gerenciar.' },
      { title: 'Pronto!', description: 'Suas campanhas LinkedIn serão importadas.' },
    ],
    warning: 'Você precisa ser administrador da página da empresa no LinkedIn.',
  },
];

const COMING_SOON_PLATFORMS = [
  { name: 'Pinterest Ads', icon: '📌' },
  { name: 'Twitter/X Ads', icon: '𝕏' },
  { name: 'Snapchat Ads', icon: '👻' },
  { name: 'Microsoft Ads', icon: '🔷' },
];

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function ConnectionsTab() {
  const { user } = useAuth();
  const meta = useMetaConnection();
  const google = useGoogleAdsConnection();
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [tiktokLoading, setTiktokLoading] = useState(false);
  const [linkedinLoading, setLinkedinLoading] = useState(false);
  const [igLoading, setIgLoading] = useState(false);

  // Instagram Publisher connected account
  const { data: igPublisherAccount, refetch: refetchIg } = useQuery({
    queryKey: ['ig-publisher', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('connected_accounts' as any)
        .select('*')
        .eq('platform', 'instagram_publisher')
        .eq('user_id', user?.id)
        .maybeSingle();
      return data as { account_name: string; extra_data: any } | null;
    },
    enabled: !!user,
  });

  // LinkedIn connected account
  const { data: linkedinAccount, refetch: refetchLinkedIn } = useQuery({
    queryKey: ['linkedin-account', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('connected_accounts' as any)
        .select('*')
        .eq('platform', 'linkedin')
        .eq('user_id', user?.id)
        .maybeSingle();
      return data as { account_name: string; account_id: string } | null;
    },
    enabled: !!user,
  });

  // TikTok accounts
  const { data: tiktokAccounts = [] } = useQuery({
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

  /* ---------- connection status helpers ---------- */

  const getConnectionStatus = (platformId: string): 'connected' | 'connecting' | 'disconnected' => {
    switch (platformId) {
      case 'meta':
        return meta.connectedAccount ? 'connected' : meta.isConnecting ? 'connecting' : 'disconnected';
      case 'google_ads':
        return google.connectedAccount ? 'connected' : google.isConnecting ? 'connecting' : 'disconnected';
      case 'tiktok':
        return tiktokAccounts.length > 0 ? 'connected' : tiktokLoading ? 'connecting' : 'disconnected';
      case 'linkedin':
        return linkedinAccount ? 'connected' : linkedinLoading ? 'connecting' : 'disconnected';
      case 'instagram_publisher':
        return igPublisherAccount ? 'connected' : igLoading ? 'connecting' : 'disconnected';
      default:
        return 'disconnected';
    }
  };

  const getAccountName = (platformId: string): string | null => {
    switch (platformId) {
      case 'meta':
        return meta.connectedAccount?.account_name ?? null;
      case 'google_ads':
        return google.connectedAccount?.account_name ?? null;
      case 'tiktok':
        return tiktokAccounts[0]?.account_name ?? null;
      case 'linkedin':
        return linkedinAccount?.account_name ?? null;
      case 'instagram_publisher':
        return igPublisherAccount?.extra_data?.username
          ? `@${igPublisherAccount.extra_data.username}`
          : igPublisherAccount?.account_name ?? null;
      default:
        return null;
    }
  };

  /* ---------- connect handlers ---------- */

  const handleConnect = async (platformId: string) => {
    switch (platformId) {
      case 'meta':
        await meta.startOAuth();
        break;
      case 'google_ads':
        try {
          await google.startOAuth();
        } catch (err: any) {
          // Error is already handled by the hook's toast
        }
        break;
      case 'tiktok':
        setTiktokLoading(true);
        try {
          const redirectUri = `${window.location.origin}/connect-accounts?tiktok_callback=true`;
          const { data, error } = await supabase.functions.invoke('tiktok-oauth', {
            body: { action: 'get_auth_url', redirect_uri: redirectUri },
          });
          if (error) throw error;
          if (data?.auth_url) {
            window.location.href = data.auth_url;
          } else {
            toast.error('TikTok App ID não configurado.');
          }
        } catch (err: any) {
          toast.error(err.message || 'Erro ao iniciar conexão TikTok');
        } finally {
          setTiktokLoading(false);
        }
        break;
      case 'linkedin': {
        setLinkedinLoading(true);
        // Abre popup ANTES do await para não ser bloqueado pelo browser
        const linkedinPopup = window.open('about:blank', 'linkedin_oauth', 'width=600,height=700,left=200,top=100');
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) { linkedinPopup?.close(); throw new Error('Sessão expirada'); }
          const { data, error } = await supabase.functions.invoke('linkedin-ads-oauth', {
            body: { action: 'authorize', user_id: session.user.id },
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (error) { linkedinPopup?.close(); throw error; }
          if (data?.auth_url) {
            if (linkedinPopup) linkedinPopup.location.href = data.auth_url;
            const popup = linkedinPopup;
            const handler = (event: MessageEvent) => {
              if (event.data?.type === 'LINKEDIN_AUTH_SUCCESS') {
                popup?.close();
                toast.success(`LinkedIn Ads conectado: ${event.data.accountName}`);
                refetchLinkedIn();
                setLinkedinLoading(false);
                window.removeEventListener('message', handler);
              } else if (event.data?.type === 'LINKEDIN_AUTH_ERROR') {
                popup?.close();
                toast.error(event.data.error || 'Erro ao conectar LinkedIn');
                setLinkedinLoading(false);
                window.removeEventListener('message', handler);
              }
            };
            window.addEventListener('message', handler);
            // Fallback: stop loading if popup closes without postMessage
            const timer = setInterval(() => {
              if (popup?.closed) {
                clearInterval(timer);
                setLinkedinLoading(false);
                window.removeEventListener('message', handler);
              }
            }, 1000);
          } else {
            linkedinPopup?.close();
            toast.error('URL de autenticação LinkedIn não retornada');
            setLinkedinLoading(false);
          }
        } catch (err: any) {
          linkedinPopup?.close();
          toast.error(err.message || 'Erro ao conectar LinkedIn');
          setLinkedinLoading(false);
        }
        break;
      }
      case 'instagram_publisher': {
        setIgLoading(true);
        // Abre popup ANTES do await para não ser bloqueado pelo browser
        const igPopup = window.open('about:blank', 'ig_publish_oauth', 'width=600,height=700,left=200,top=100');
        // Verifica se popup foi bloqueado imediatamente
        if (!igPopup || igPopup.closed) {
          toast.error('Popup bloqueado pelo navegador. Clique no ícone 🔒 na barra de endereços, permita popups para este site e tente novamente.');
          setIgLoading(false);
          break;
        }
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) { igPopup.close(); throw new Error('Sessão expirada. Faça login novamente.'); }
          const { data, error } = await supabase.functions.invoke('instagram-publish-oauth', {
            body: { action: 'authorize' },
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          // Extrai mensagem real do erro (FunctionsHttpError tem context com body real)
          if (error) {
            igPopup.close();
            const realMsg = (error as any)?.context?.error || (error as any)?.message || 'Erro ao conectar Instagram';
            throw new Error(realMsg);
          }
          if (data?.error) {
            igPopup.close();
            throw new Error(data.error);
          }
          if (data?.auth_url) {
            igPopup.location.href = data.auth_url;
            const handler = (event: MessageEvent) => {
              if (event.data?.type === 'IG_PUBLISH_AUTH_SUCCESS') {
                igPopup.close();
                toast.success(`Instagram @${event.data.username} conectado!`);
                refetchIg();
                setIgLoading(false);
                window.removeEventListener('message', handler);
              } else if (event.data?.type === 'IG_PUBLISH_AUTH_ERROR') {
                igPopup.close();
                toast.error(event.data.error || 'Erro ao conectar Instagram');
                setIgLoading(false);
                window.removeEventListener('message', handler);
              }
            };
            window.addEventListener('message', handler);
            const timer = setInterval(() => {
              if (igPopup.closed) {
                clearInterval(timer);
                setIgLoading(false);
                window.removeEventListener('message', handler);
              }
            }, 1000);
          } else {
            igPopup.close();
            toast.error('URL de autenticação não retornada. Verifique as configurações do Facebook App.');
            setIgLoading(false);
          }
        } catch (err: any) {
          igPopup?.close();
          toast.error(err.message || 'Erro ao conectar Instagram');
          setIgLoading(false);
        }
        break;
      }
      default:
        toast.info('Esta integração estará disponível em breve!');
    }
  };

  const handleDisconnect = async (platformId: string) => {
    switch (platformId) {
      case 'meta':
        meta.disconnect();
        break;
      case 'google_ads':
        google.disconnect();
        break;
      case 'tiktok':
        await supabase
          .from('ad_accounts')
          .update({ is_active: false })
          .eq('platform', 'tiktok')
          .eq('user_id', user?.id);
        toast.success('TikTok Ads desconectado');
        break;
      case 'linkedin':
        await supabase
          .from('connected_accounts' as any)
          .update({ expires_at: new Date(0).toISOString() } as any)
          .eq('platform', 'linkedin')
          .eq('user_id', user?.id);
        refetchLinkedIn();
        toast.success('LinkedIn Ads desconectado');
        break;
      case 'instagram_publisher': {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await supabase.functions.invoke('instagram-publish-oauth', {
            body: { action: 'disconnect' },
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
        }
        refetchIg();
        toast.success('Instagram Business desconectado');
        break;
      }
    }
  };

  const activePlatform = PLATFORMS.find(p => p.id === selectedPlatform);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/10 p-4">
        <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">Conexão segura.</strong> Usamos OAuth 2.0 — suas senhas nunca são compartilhadas. Apenas lemos dados de campanhas.
        </p>
      </div>

      {/* Platform Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {PLATFORMS.map((platform) => {
          const status = platform.status === 'coming_soon' ? 'disconnected' : getConnectionStatus(platform.id);
          const accountName = getAccountName(platform.id);
          const isComingSoon = platform.status === 'coming_soon';

          return (
            <Card
              key={platform.id}
              className={`border-border/50 bg-card/50 backdrop-blur-sm transition-all hover:shadow-md ${
                status === 'connected' ? 'border-success/30' : ''
              } ${isComingSoon ? 'opacity-75' : ''}`}
            >
              <CardContent className="p-5 flex flex-col h-full">
                {/* Top row: icon + badge */}
                <div className="flex items-start justify-between mb-4">
                  <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${platform.iconBg}`}>
                    {platform.icon}
                  </div>
                  {isComingSoon ? (
                    <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30 text-[10px]">
                      <Clock className="h-3 w-3 mr-1" />
                      Em breve
                    </Badge>
                  ) : status === 'connected' ? (
                    <Badge className="bg-success/20 text-success border-success/30 text-[10px]">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Conectado
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">
                      <XCircle className="h-3 w-3 mr-1" />
                      Desconectado
                    </Badge>
                  )}
                </div>

                {/* Name + description */}
                <h3 className="font-semibold text-foreground">{platform.name}</h3>
                <p className="text-xs text-muted-foreground mt-1 flex-1">{platform.description}</p>

                {/* Connected account name */}
                {status === 'connected' && accountName && (
                  <p className="text-xs text-success mt-2 truncate">✅ {accountName}</p>
                )}

                {/* Actions */}
                <div className="flex gap-2 mt-4">
                  {isComingSoon ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => setSelectedPlatform(platform.id)}
                    >
                      Ver detalhes
                    </Button>
                  ) : status === 'connected' ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-xs"
                        onClick={() => setSelectedPlatform(platform.id)}
                      >
                        Detalhes
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs text-destructive hover:text-destructive"
                        onClick={() => handleDisconnect(platform.id)}
                      >
                        Desconectar
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        className="flex-1 text-xs gradient-primary text-primary-foreground"
                        onClick={() => handleConnect(platform.id)}
                        disabled={status === 'connecting'}
                      >
                        {status === 'connecting' ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <ExternalLink className="h-3 w-3 mr-1" />
                        )}
                        Conectar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => setSelectedPlatform(platform.id)}
                      >
                        Como fazer?
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Coming soon smaller cards */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Em breve</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {COMING_SOON_PLATFORMS.map((p) => (
            <div
              key={p.name}
              className="flex items-center gap-3 rounded-lg border border-border/40 bg-muted/20 p-3 opacity-60"
            >
              <span className="text-xl">{p.icon}</span>
              <span className="text-xs font-medium text-muted-foreground">{p.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Detail / How-to modal */}
      <Dialog open={!!selectedPlatform} onOpenChange={(open) => !open && setSelectedPlatform(null)}>
        {activePlatform && (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="flex items-center gap-3 mb-1">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${activePlatform.iconBg}`}>
                  {activePlatform.icon}
                </div>
                <div>
                  <DialogTitle>{activePlatform.name}</DialogTitle>
                  <DialogDescription>{activePlatform.description}</DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-1 mt-2">
              <p className="text-sm font-medium text-foreground mb-3">📋 Passo a passo</p>
              {activePlatform.steps.map((step, i) => (
                <div key={i} className="flex gap-3 pb-4 relative">
                  <div className="flex flex-col items-center">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0">
                      {i + 1}
                    </div>
                    {i < activePlatform.steps.length - 1 && (
                      <div className="w-px flex-1 bg-border/50 mt-1.5" />
                    )}
                  </div>
                  <div className="pt-0.5">
                    <p className="font-medium text-sm">{step.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>

            {activePlatform.warning && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-600 dark:text-amber-400">
                ⚠️ {activePlatform.warning}
              </div>
            )}

            <div className="flex items-center gap-2 rounded-lg bg-success/5 border border-success/20 p-3 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 shrink-0 text-success" />
              <span>
                <strong className="text-foreground">100% seguro.</strong> Nós só lemos dados — nunca alteramos suas campanhas.
              </span>
            </div>

            {activePlatform.status === 'available' && getConnectionStatus(activePlatform.id) !== 'connected' && (
              <Button
                className="w-full gradient-primary text-primary-foreground"
                onClick={() => {
                  setSelectedPlatform(null);
                  handleConnect(activePlatform.id);
                }}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Conectar {activePlatform.name}
              </Button>
            )}

            {activePlatform.status === 'coming_soon' && (
              <p className="text-center text-xs text-muted-foreground">
                Esta integração estará disponível em breve. Fique ligado nas atualizações!
              </p>
            )}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
