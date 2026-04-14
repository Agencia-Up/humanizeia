import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2, CheckCircle, QrCode, RefreshCw, Smartphone, Globe,
} from 'lucide-react';

type Step = 'provider' | 'instance' | 'meta_credentials' | 'qrcode' | 'connected';
type Provider = 'evolution' | 'meta';

interface EvolutionConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: () => void;
  initialInstanceName?: string;
  initialFriendlyName?: string;
}

export function EvolutionConnectDialog({ open, onOpenChange, onConnected, initialInstanceName, initialFriendlyName }: EvolutionConnectDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>('provider');
  const [provider, setProvider] = useState<Provider>('evolution');

  // Evolution fields
  const [friendlyName, setFriendlyName] = useState('');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  // Meta fields
  const [metaPhoneNumberId, setMetaPhoneNumberId] = useState('');
  const [metaWabaId, setMetaWabaId] = useState('');
  const [metaAccessToken, setMetaAccessToken] = useState('');
  const [metaFriendlyName, setMetaFriendlyName] = useState('');

  const [isCreating, setIsCreating] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const realtimeChannel = useRef<any>(null);

  useEffect(() => {
    if (open) {
      if (initialInstanceName) {
        setFriendlyName(initialFriendlyName || initialInstanceName);
        setActiveSlug(initialInstanceName);
        setProvider('evolution');
        handleCreateUazapiInstance(initialInstanceName);
      }
    } else {
      stopPolling();
      setStep('provider');
      setProvider('evolution');
      setQrCode(null);
      setIsCreating(false);
      setFriendlyName('');
      setActiveSlug(null);
      setMetaPhoneNumberId(''); setMetaWabaId(''); setMetaAccessToken(''); setMetaFriendlyName('');
    }
  }, [open, initialInstanceName, initialFriendlyName]);

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
      const { data, error } = await supabase.functions.invoke('create-evolution-instance', {
        body: {
          provider: 'evolution',
          instance_name: String(slug),
          friendly_name: String(friendlyName || activeOverride || ""),
          user_id: String(user?.id || ""),
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao criar instância');
      setQrCode(data.qr_code || null);
      setStep('qrcode');
      startPolling(slug);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar instância');
    } finally {
      setIsCreating(false);
    }
  };

  // ========== META FLOW ==========
  const handleCreateMetaInstance = async () => {
    if (!metaPhoneNumberId || !metaAccessToken || !metaFriendlyName) {
      toast.error('Preencha todos os campos obrigatórios'); return;
    }
    setIsCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-evolution-instance', {
        body: {
          provider: 'meta',
          user_id: user!.id,
          friendly_name: metaFriendlyName.trim(),
          phone_number_id: metaPhoneNumberId.trim(),
          waba_id: metaWabaId.trim() || null,
          access_token: metaAccessToken.trim(),
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao conectar Meta API');
      setStep('connected');
      queryClient.invalidateQueries({ queryKey: ['whatsapp-config'] });
      queryClient.invalidateQueries({ queryKey: ['wa-instances'] });
      onConnected?.();
      toast.success(`Meta API conectada! Número: ${data.phone_number || 'verificado'}`);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao conectar Meta API');
    } finally {
      setIsCreating(false);
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
        const { data, error } = await supabase.functions.invoke('get-evolution-qrcode', {
          body: { user_id: user!.id, instance_name: slug },
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
    stopPolling();
    setStep('connected');
    queryClient.invalidateQueries({ queryKey: ['wa-instances'] });
    onConnected?.();

    // Auto-sync webhook URL with the Evolution/UAZAPI instance
    if (activeSlug && user) {
      try {
        const { data: inst } = await supabase
          .from('wa_instances')
          .select('id')
          .eq('instance_name', activeSlug)
          .maybeSingle();
        if (inst?.id) {
          await supabase.functions.invoke('sync-evolution-webhook', {
            body: { instance_id: inst.id, user_id: user.id },
          });
          console.log('[EvolutionConnect] Webhook sincronizado para', activeSlug);
        }
      } catch (e) {
        console.warn('[EvolutionConnect] Falha ao sincronizar webhook:', e);
      }
    }
  };

  const handleRefreshQr = async () => {
    if (!activeSlug) return;
    try {
      const { data } = await supabase.functions.invoke('get-evolution-qrcode', {
        body: { user_id: user!.id, instance_name: activeSlug },
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
            {step === 'meta_credentials' && 'Configurar Meta API'}
            {step === 'qrcode' && 'Escanear QR Code'}
            {step === 'connected' && 'Conectado!'}
          </DialogTitle>
          <DialogDescription>
            {step === 'provider' && 'Escolha o provedor para conectar seu WhatsApp'}
            {step === 'instance' && 'Escolha um nome e escaneie o QR Code no celular'}
            {step === 'meta_credentials' && 'Informe os dados da API Oficial do Meta'}
            {step === 'qrcode' && 'Abra o WhatsApp no celular e escaneie o QR Code'}
            {step === 'connected' && 'Sua instância WhatsApp está conectada com sucesso'}
          </DialogDescription>
        </DialogHeader>

        {/* Step: Provider Selection */}
        {step === 'provider' && (
          <div className="space-y-3 py-2">
            <button
              onClick={() => { setProvider('evolution'); setStep('instance'); }}
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

        {/* Evolution: Just name + create */}
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

        {/* Meta: Credentials */}
        {step === 'meta_credentials' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da Conexão *</Label>
              <Input value={metaFriendlyName} onChange={e => setMetaFriendlyName(e.target.value)} placeholder="Ex: Minha Empresa" />
            </div>
            <div className="space-y-2">
              <Label>Phone Number ID *</Label>
              <Input value={metaPhoneNumberId} onChange={e => setMetaPhoneNumberId(e.target.value)} placeholder="Ex: 123456789012345" />
              <p className="text-xs text-muted-foreground">Encontrado no Meta Business Suite → WhatsApp → Configurações da API</p>
            </div>
            <div className="space-y-2">
              <Label>WABA ID (opcional)</Label>
              <Input value={metaWabaId} onChange={e => setMetaWabaId(e.target.value)} placeholder="WhatsApp Business Account ID" />
            </div>
            <div className="space-y-2">
              <Label>Access Token *</Label>
              <Input type="password" value={metaAccessToken} onChange={e => setMetaAccessToken(e.target.value)} placeholder="Token de acesso permanente" />
              <p className="text-xs text-muted-foreground">Use um System User Token de longa duração do Meta Business</p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep('provider')} className="flex-1">Voltar</Button>
              <Button
                onClick={handleCreateMetaInstance}
                disabled={isCreating || !metaPhoneNumberId || !metaAccessToken || !metaFriendlyName}
                className="flex-1 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white"
              >
                {isCreating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Globe className="h-4 w-4 mr-2" />}
                Conectar Meta API
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
                  <img
                    src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                    alt="QR Code WhatsApp"
                    className="h-64 w-64"
                  />
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
