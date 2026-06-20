import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { WhatsAppQrCode } from '@/components/uazapi/WhatsAppQrCode';
import {
  Loader2, CheckCircle, QrCode, RefreshCw, Smartphone, Globe,
} from 'lucide-react';

type Step = 'provider' | 'instance' | 'meta_credentials' | 'qrcode' | 'connected';
type Provider = 'uazapi' | 'meta';

// Config publica do App do Meta (NAO sao segredos): App ID + Configuration ID
// do Embedded Signup. Vem do .env (VITE_*). Sem isso, o botao do Facebook avisa.
const META_APP_ID = ((import.meta as any).env?.VITE_META_APP_ID as string | undefined) || '';
const META_CONFIG_ID = ((import.meta as any).env?.VITE_META_CONFIG_ID as string | undefined) || '';
const FB_SDK_VERSION = 'v23.0';

// Carrega o SDK do Facebook uma vez e resolve quando window.FB esta pronto.
function loadFacebookSdk(appId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.FB) { resolve(w.FB); return; }
    w.fbAsyncInit = function () {
      try {
        w.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: FB_SDK_VERSION });
        resolve(w.FB);
      } catch (e) { reject(e); }
    };
    if (!document.getElementById('facebook-jssdk')) {
      const js = document.createElement('script');
      js.id = 'facebook-jssdk';
      js.src = 'https://connect.facebook.net/en_US/sdk.js';
      js.async = true; js.defer = true; (js as any).crossOrigin = 'anonymous';
      js.onerror = () => reject(new Error('Falha ao carregar o SDK do Facebook'));
      document.body.appendChild(js);
    }
  });
}

interface UazapiConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Callback opcional ao concluir. Recebe o id da instância criada se conhecido.
  onConnected?: (instanceId?: string) => void;
  initialInstanceName?: string;
  initialFriendlyName?: string;
  // Quando passado, ao concluir a conexão (UAZAPI ou Meta) o id da nova
  // instância é vinculado a esse agente (wa_ai_agents.instance_ids).
  agentId?: string;
}

export function UazapiConnectDialog({ open, onOpenChange, onConnected, initialInstanceName, initialFriendlyName, agentId }: UazapiConnectDialogProps) {
  const { user } = useAuth();
  const { isSeller, seller } = useSellerProfile(user?.id);
  const queryClient = useQueryClient();

  // Modelo unificado: TODA instância vai pra conta master (user_id = master_id).
  // Quando vendedor cria, marcamos seller_member_id pra isolar visibilidade dele.
  // Master logado: user_id = ele mesmo, sem seller_member_id.
  const effectiveOwnerId = (isSeller && seller?.user_id) ? seller.user_id : user?.id;
  const effectiveSellerMemberId = (isSeller && seller?.id) ? seller.id : null;

  const [step, setStep] = useState<Step>('provider');
  const [provider, setProvider] = useState<Provider>('uazapi');

  // UaZapi fields
  const [friendlyName, setFriendlyName] = useState('');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  // Meta (Embedded Signup): só o nome amigável; phone_number_id/waba_id/token
  // vêm do popup do Facebook, não são digitados.
  const [metaFriendlyName, setMetaFriendlyName] = useState('');
  const [metaConnecting, setMetaConnecting] = useState(false);
  // phone_number_id + waba_id capturados do evento WA_EMBEDDED_SIGNUP.
  const sessionInfoRef = useRef<{ phone_number_id?: string; waba_id?: string }>({});

  const [isCreating, setIsCreating] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const realtimeChannel = useRef<any>(null);
  // Mutex pra race condition: Realtime e polling disparam handleSuccess em
  // paralelo. Sem flag, queryClient invalida 2x, onConnected chama 2x,
  // sync-uazapi-webhook é chamado em duplicata (causa instabilidade).
  const successHandledRef = useRef(false);

  useEffect(() => {
    if (open) {
      if (initialInstanceName) {
        setFriendlyName(initialFriendlyName || initialInstanceName);
        setActiveSlug(initialInstanceName);
        setProvider('uazapi');
        // Reconectar instância existente: buscar QR diretamente sem criar nova
        handleReconnectExisting(initialInstanceName);
      }
    } else {
      stopPolling();
      setStep('provider');
      setProvider('uazapi');
      setQrCode(null);
      setIsCreating(false);
      setFriendlyName('');
      setActiveSlug(null);
      successHandledRef.current = false;
      setMetaFriendlyName(''); setMetaConnecting(false);
      sessionInfoRef.current = {};
    }
  }, [open, initialInstanceName, initialFriendlyName]);

  // ── Embedded Signup: ouve o evento WA_EMBEDDED_SIGNUP do popup do Facebook ──
  // (traz phone_number_id + waba_id). Só ativo enquanto o dialog está aberto.
  useEffect(() => {
    if (!open) return;
    const onMessage = (event: MessageEvent) => {
      const origin = String(event.origin || '');
      if (origin !== 'https://www.facebook.com' && !origin.endsWith('.facebook.com')) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type === 'WA_EMBEDDED_SIGNUP' && data?.data) {
          if (data.data.phone_number_id) sessionInfoRef.current.phone_number_id = data.data.phone_number_id;
          if (data.data.waba_id) sessionInfoRef.current.waba_id = data.data.waba_id;
        }
      } catch { /* evento não-JSON do Facebook, ignora */ }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [open]);

  const stopPolling = () => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    if (realtimeChannel.current) { 
        console.log('[Realtime] Desconectando canal...');
        supabase.removeChannel(realtimeChannel.current); 
        realtimeChannel.current = null; 
    }
  };

  const generateSlug = (name: string) =>
    name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  // ========== UAZAPI FLOW (Managed Mode) ==========
  const handleCreateUazapiInstance = async (overrideSlug?: string) => {
    // Garantir que overrideSlug seja uma string (evita erro de circular structure se for evento)
    const activeOverride = typeof overrideSlug === 'string' ? overrideSlug : undefined;
    const slug = activeOverride || generateSlug(friendlyName || 'midas-instance');
    if (!slug) { toast.error('Informe um nome para a conexão'); return; }
    setIsCreating(true);
    setActiveSlug(slug);
    try {
      const { data, error } = await supabase.functions.invoke('create-uazapi-instance', {
        body: {
          provider: 'uazapi',
          instance_name: String(slug),
          friendly_name: String(friendlyName || activeOverride || ""),
          user_id: String(effectiveOwnerId || ""),
          seller_member_id: effectiveSellerMemberId,
        },
      });
      if (error) throw error;
      if (!data?.success) {
        // 28/05/2026 — payload de erro tem admin_probe + attempted_endpoints
        // pra diagnosticar exatamente o que o servidor UaZapi respondeu.
        // Mantem visivel no console pra debug sem precisar de logs Supabase.
        console.error('[create-uazapi-instance] Diagnostico completo:', {
          error: data?.error,
          admin_probe: data?.admin_probe,
          attempted_endpoints: data?.attempted_endpoints,
          url_host: data?.url_host,
          response_body: data?.response_body,
        });
        throw new Error(data?.error || 'Erro ao criar instância');
      }
      const createdSlug = data.instance_name || slug;
      setActiveSlug(createdSlug);
      setQrCode(data.qr_code || null);
      setStep('qrcode');
      startPolling(createdSlug);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar instância');
    } finally {
      setIsCreating(false);
    }
  };

  // ========== RECONNECT EXISTING INSTANCE (busca QR sem criar novo registro) ==========
  const handleReconnectExisting = async (slug: string) => {
    setIsCreating(true);
    setStep('qrcode');
    try {
      const { data, error } = await supabase.functions.invoke('get-uazapi-qrcode', {
        body: {
          user_id: effectiveOwnerId || user!.id,
          instance_name: slug,
          seller_member_id: effectiveSellerMemberId,
        },
      });
      if (error) throw error;
      if (data?.connected) {
        handleSuccess();
        return;
      }
      setQrCode(data?.qr_code || null);
      startPolling(slug);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao buscar QR Code da instância');
      setStep('instance');
    } finally {
      setIsCreating(false);
    }
  };

  // Vincula a instância criada ao agente passado (instance_ids[] do wa_ai_agents).
  // Soma ao array existente sem duplicar. Best-effort: erro NAO trava o fluxo.
  const linkInstanceToAgent = async (instanceId: string | null | undefined) => {
    if (!agentId || !instanceId) return;
    try {
      const { data: ag } = await (supabase as any)
        .from('wa_ai_agents')
        .select('instance_id, instance_ids')
        .eq('id', agentId)
        .maybeSingle();
      const current: string[] = Array.isArray(ag?.instance_ids) ? ag.instance_ids : [];
      const next = current.includes(instanceId) ? current : [...current, instanceId];
      await (supabase as any)
        .from('wa_ai_agents')
        .update({ instance_id: ag?.instance_id || instanceId, instance_ids: next, updated_at: new Date().toISOString() })
        .eq('id', agentId);
    } catch (e) {
      console.warn('[UazapiConnect] Falha ao vincular instância ao agente:', e);
    }
  };

  // ========== META FLOW (Embedded Signup oficial) ==========
  const handleEmbeddedSignup = async () => {
    if (!metaFriendlyName.trim()) { toast.error('Informe um nome para a conexão'); return; }
    if (!META_APP_ID || !META_CONFIG_ID) {
      toast.error('Embedded Signup não configurado (VITE_META_APP_ID / VITE_META_CONFIG_ID).');
      return;
    }
    setMetaConnecting(true);
    sessionInfoRef.current = {};
    try {
      const FB = await loadFacebookSdk(META_APP_ID);
      FB.login((response: any) => {
        const code = response?.authResponse?.code;
        if (!code) {
          setMetaConnecting(false);
          toast.error('Conexão cancelada no Facebook.');
          return;
        }
        void finishEmbeddedSignup(code);
      }, {
        config_id: META_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
      });
    } catch (err: any) {
      setMetaConnecting(false);
      toast.error(err?.message || 'Falha ao abrir o Facebook');
    }
  };

  const finishEmbeddedSignup = async (code: string) => {
    try {
      // O evento WA_EMBEDDED_SIGNUP normalmente chega antes do callback; dá um
      // respiro curto caso ainda não tenha populado phone_number_id/waba_id.
      if (!sessionInfoRef.current.phone_number_id) {
        await new Promise((r) => setTimeout(r, 600));
      }
      const { phone_number_id, waba_id } = sessionInfoRef.current;
      if (!phone_number_id) {
        throw new Error('Não recebi o número do Facebook. Tente novamente e conclua o passo do número.');
      }
      const { data, error } = await supabase.functions.invoke('meta-embedded-signup', {
        body: {
          code,
          phone_number_id,
          waba_id: waba_id || null,
          friendly_name: metaFriendlyName.trim(),
          user_id: effectiveOwnerId,
          seller_member_id: effectiveSellerMemberId,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao conectar a API oficial do Meta');
      // Vincula a instância nova ao agente (se aberto a partir do AgentFormDialog).
      await linkInstanceToAgent(data.instance_id);
      setStep('connected');
      queryClient.invalidateQueries({ queryKey: ['whatsapp-config'] });
      queryClient.invalidateQueries({ queryKey: ['wa-instances'] });
      onConnected?.(data.instance_id);
      toast.success(`WhatsApp oficial conectado! Número: ${data.phone_number || 'verificado'}`);
      if (data.warning) console.warn('[meta-embedded-signup] aviso:', data.warning);
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao conectar a API oficial do Meta');
    } finally {
      setMetaConnecting(false);
    }
  };

  const startPolling = (slug: string) => {
    stopPolling();
    console.log(`[polling] Monitorando conexão de: ${slug} (Realtime + Polling fallback)`);
    
    // 1. Realtime Subscription (Mais rápido)
    realtimeChannel.current = supabase
      .channel(`instance-status-${slug}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'wa_instances', filter: `instance_name=eq.${slug}` },
        (payload: any) => {
          console.log('[Realtime] Mudança detectada:', payload.new.status, payload.new.is_active);
          if (payload.new.is_active || payload.new.status === 'connected') {
            console.log('[Realtime] SINAL DE CONEXÃO RECEBIDO!');
            handleSuccess();
          }
        }
      )
      .subscribe();

    // 2. Polling Fallback
    pollingRef.current = setInterval(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('get-uazapi-qrcode', {
          body: {
            user_id: effectiveOwnerId || user!.id,
            instance_name: slug,
            seller_member_id: effectiveSellerMemberId,
          },
        });
        if (error) return;
        if (data?.connected) {
          handleSuccess();
        } else if (data?.qr_code) {
          setQrCode(data.qr_code);
        }
      } catch {}
    }, 5000);
  };

  const handleSuccess = async () => {
    // Mutex contra race condition Realtime + polling. Sem isso, ambos os
    // canais disparam handleSuccess quase simultaneamente quando status muda
    // pra 'connected', causando invalidateQueries 2x, onConnected 2x, e
    // sync-uazapi-webhook duplicado.
    if (successHandledRef.current) return;
    successHandledRef.current = true;

    stopPolling();
    setStep('connected');
    queryClient.invalidateQueries({ queryKey: ['wa-instances'] });

    // Auto-sync webhook URL + vincular ao agente (quando aberto pelo AgentFormDialog).
    let resolvedInstanceId: string | undefined;
    if (activeSlug && user) {
      try {
        const { data: inst } = await supabase
          .from('wa_instances')
          .select('id')
          .eq('instance_name', activeSlug)
          .eq('user_id', effectiveOwnerId || user.id)
          .maybeSingle();
        if (inst?.id) {
          resolvedInstanceId = inst.id;
          await supabase.functions.invoke('sync-uazapi-webhook', {
            body: { instance_id: inst.id, user_id: effectiveOwnerId || user.id },
          });
          console.log('[UazapiConnect] Webhook sincronizado para', activeSlug);
          await linkInstanceToAgent(inst.id);
        }
      } catch (e) {
        console.warn('[UazapiConnect] Falha ao sincronizar webhook:', e);
      }
    }
    onConnected?.(resolvedInstanceId);
  };

  const handleRefreshQr = async () => {
    if (!activeSlug) return;
    try {
      const { data } = await supabase.functions.invoke('get-uazapi-qrcode', {
        body: {
          user_id: effectiveOwnerId || user!.id,
          instance_name: activeSlug,
          seller_member_id: effectiveSellerMemberId,
        },
      });
      if (data?.connected) {
        handleSuccess();
      } else if (data?.qr_code) {
        setQrCode(data.qr_code);
        toast.success('QR Code atualizado');
      }
    } catch { toast.error('Erro ao atualizar QR'); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 'connected' ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <Smartphone className="h-5 w-5 text-green-500" />
            )}
            {step === 'provider' && 'Conectar WhatsApp'}
            {step === 'instance' && 'Nome da Conexão'}
            {step === 'meta_credentials' && 'WhatsApp Oficial (Meta)'}
            {step === 'qrcode' && 'Escanear QR Code'}
            {step === 'connected' && 'Conectado!'}
          </DialogTitle>
          <DialogDescription>
            {step === 'provider' && 'Escolha o provedor para conectar seu WhatsApp'}
            {step === 'instance' && 'Escolha um nome e escaneie o QR Code no celular'}
            {step === 'meta_credentials' && 'Conecte pelo Facebook — sem colar token'}
            {step === 'qrcode' && 'Abra o WhatsApp no celular e escaneie o QR Code'}
            {step === 'connected' && 'Sua instância WhatsApp está conectada com sucesso'}
          </DialogDescription>
        </DialogHeader>

        {/* Step: Provider Selection */}
        {step === 'provider' && (
          <div className="space-y-3 py-2">
            <button
              onClick={() => { setProvider('uazapi'); setStep('instance'); }}
              className="w-full flex items-center gap-4 p-4 rounded-lg border border-border hover:border-green-500/50 hover:bg-green-500/5 transition-all text-left"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-500/10 shrink-0">
                <QrCode className="h-6 w-6 text-green-500" />
              </div>
              <div>
                <p className="font-medium">WhatsApp (QR Code)</p>
                <p className="text-xs text-muted-foreground">Conecte escaneando o QR Code direto aqui. Simples e rápido.</p>
              </div>
              <Badge variant="secondary" className="ml-auto shrink-0">Popular</Badge>
            </button>

            <button
              onClick={() => { setProvider('meta'); setStep('meta_credentials'); }}
              className="w-full flex items-center gap-4 p-4 rounded-lg border border-border hover:border-blue-500/50 hover:bg-blue-500/5 transition-all text-left"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/10 shrink-0">
                <Globe className="h-6 w-6 text-blue-500" />
              </div>
              <div>
                <p className="font-medium">Meta API Oficial</p>
                <p className="text-xs text-muted-foreground">API oficial do WhatsApp Business. Maior estabilidade, ideal para alto volume.</p>
              </div>
              <Badge variant="outline" className="ml-auto shrink-0 text-blue-500 border-blue-500/30">Oficial</Badge>
            </button>
          </div>
        )}

        {/* UaZapi: Just name + create */}
        {step === 'instance' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da conexão</Label>
              <Input value={friendlyName} onChange={e => setFriendlyName(e.target.value)} placeholder="Ex: Minha Empresa" />
              <p className="text-xs text-muted-foreground">
                Esse nome é apenas para identificar a conexão dentro da plataforma.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep('provider')} className="flex-1">Voltar</Button>
              <Button
                onClick={() => handleCreateUazapiInstance()}
                disabled={isCreating || !friendlyName}
                className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white"
              >
                {isCreating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <QrCode className="h-4 w-4 mr-2" />}
                Gerar QR Code
              </Button>
            </div>
          </div>
        )}

        {/* Meta: Embedded Signup */}
        {step === 'meta_credentials' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da conexão *</Label>
              <Input value={metaFriendlyName} onChange={e => setMetaFriendlyName(e.target.value)} placeholder="Ex: Minha Empresa" />
              <p className="text-xs text-muted-foreground">
                Só pra identificar a conexão aqui na plataforma.
              </p>
            </div>
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Ao clicar abaixo, abre o login oficial do Facebook. Você escolhe (ou cria) a conta
                do WhatsApp Business e o número — sem precisar colar nenhum token. Ao final, o número
                já fica conectado.
              </p>
            </div>
            {(!META_APP_ID || !META_CONFIG_ID) && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Conexão oficial ainda não configurada no servidor. Avise o suporte.
              </p>
            )}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep('provider')} className="flex-1" disabled={metaConnecting}>Voltar</Button>
              <Button
                onClick={handleEmbeddedSignup}
                disabled={metaConnecting || !metaFriendlyName.trim() || !META_APP_ID || !META_CONFIG_ID}
                className="flex-1 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white"
              >
                {metaConnecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Globe className="h-4 w-4 mr-2" />}
                Conectar com Facebook
              </Button>
            </div>
          </div>
        )}

        {/* QR Code */}
        {step === 'qrcode' && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-4">
              {qrCode ? (
                <div className="rounded-xl border border-border/50 bg-white p-4">
                  <WhatsAppQrCode value={qrCode} className="h-64 w-64" size={256} />
                </div>
              ) : (
                <div className="flex h-64 w-64 items-center justify-center rounded-xl border border-dashed border-border">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Aguardando leitura do QR Code...
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleRefreshQr} className="flex-1 text-xs">
                <RefreshCw className="h-3.5 w-3.5 mr-2" /> Já escaneei
              </Button>
              {!initialInstanceName && (
                <Button 
                    variant="ghost" 
                    onClick={() => setStep('instance')} 
                    className="flex-1 text-xs text-muted-foreground"
                >
                    Voltar
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Connected */}
        {step === 'connected' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
              <CheckCircle className="h-10 w-10 text-green-500" />
            </div>
            <div className="text-center">
              <p className="font-medium text-lg">WhatsApp conectado!</p>
              <p className="text-sm text-muted-foreground mt-1">
                Sua instância {provider === 'meta' ? 'Meta API Oficial' : 'WhatsApp'} está pronta.
              </p>
            </div>
            <Button
              onClick={() => onOpenChange(false)}
              className="mt-2 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white"
            >
              Fechar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
