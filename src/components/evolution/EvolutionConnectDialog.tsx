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
  Loader2,
  CheckCircle,
  Wifi,
  WifiOff,
  QrCode,
  ArrowRight,
  RefreshCw,
  Smartphone,
} from 'lucide-react';

type Step = 'credentials' | 'instance' | 'qrcode' | 'connected';

interface EvolutionConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: () => void;
}

export function EvolutionConnectDialog({ open, onOpenChange, onConnected }: EvolutionConnectDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>('credentials');
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [friendlyName, setFriendlyName] = useState('');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up polling on unmount or dialog close
  useEffect(() => {
    if (!open) {
      stopPolling();
      // Reset state when dialog closes
      setStep('credentials');
      setTestSuccess(false);
      setQrCode(null);
      setIsCreating(false);
      setIsTesting(false);
    }
  }, [open]);

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  };

  const handleTestConnection = async () => {
    if (!apiUrl || !apiKey) {
      toast.error('Preencha URL e API Key');
      return;
    }
    setIsTesting(true);
    setTestSuccess(false);
    try {
      const { data, error } = await supabase.functions.invoke('test-evolution-connection', {
        body: { api_url: apiUrl.trim(), api_key: apiKey.trim() },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Falha na conexão');

      setTestSuccess(true);
      toast.success(data.message || 'Conexão válida!');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao testar conexão');
    } finally {
      setIsTesting(false);
    }
  };

  const handleCreateInstance = async () => {
    const slug = generateSlug(friendlyName || 'midas-instance');
    if (!slug) {
      toast.error('Informe um nome para a conexão');
      return;
    }
    setInstanceName(slug);
    setIsCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-evolution-instance', {
        body: {
          api_url: apiUrl.trim(),
          api_key: apiKey.trim(),
          instance_name: slug,
          user_id: user!.id,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao criar instância');

      setQrCode(data.qr_code || null);
      setStep('qrcode');
      startPolling();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar instância');
    } finally {
      setIsCreating(false);
    }
  };

  const startPolling = () => {
    stopPolling();
    pollingRef.current = setInterval(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('get-evolution-qrcode', {
          body: { user_id: user!.id },
        });
        if (error) return;
        if (data?.connected) {
          stopPolling();
          setStep('connected');
          queryClient.invalidateQueries({ queryKey: ['whatsapp-config'] });
          onConnected?.();
        } else if (data?.qr_code) {
          setQrCode(data.qr_code);
        }
      } catch {}
    }, 5000);
  };

  const handleRefreshQr = async () => {
    try {
      const { data } = await supabase.functions.invoke('get-evolution-qrcode', {
        body: { user_id: user!.id },
      });
      if (data?.connected) {
        stopPolling();
        setStep('connected');
        queryClient.invalidateQueries({ queryKey: ['whatsapp-config'] });
        onConnected?.();
      } else if (data?.qr_code) {
        setQrCode(data.qr_code);
        toast.success('QR Code atualizado');
      }
    } catch {
      toast.error('Erro ao atualizar QR');
    }
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
            {step === 'credentials' && 'Conectar Evolution API'}
            {step === 'instance' && 'Criar Instância'}
            {step === 'qrcode' && 'Escanear QR Code'}
            {step === 'connected' && 'Conectado!'}
          </DialogTitle>
          <DialogDescription>
            {step === 'credentials' && 'Informe a URL e API Key da sua Evolution API'}
            {step === 'instance' && 'Escolha um nome para sua conexão WhatsApp'}
            {step === 'qrcode' && 'Abra o WhatsApp no celular e escaneie o QR Code'}
            {step === 'connected' && 'Sua Evolution API está conectada com sucesso'}
          </DialogDescription>
        </DialogHeader>

        {/* Steps indicator */}
        <div className="flex items-center justify-center gap-2 py-2">
          {(['credentials', 'instance', 'qrcode', 'connected'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`h-2.5 w-2.5 rounded-full transition-colors ${
                  s === step
                    ? 'bg-green-500'
                    : ['credentials', 'instance', 'qrcode', 'connected'].indexOf(s) < ['credentials', 'instance', 'qrcode', 'connected'].indexOf(step)
                      ? 'bg-green-500/50'
                      : 'bg-muted'
                }`}
              />
              {i < 3 && <div className="h-px w-6 bg-muted" />}
            </div>
          ))}
        </div>

        {/* Step 1: Credentials */}
        {step === 'credentials' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>URL da API</Label>
              <Input
                value={apiUrl}
                onChange={e => setApiUrl(e.target.value)}
                placeholder="https://sua-evolution-api.com"
              />
            </div>
            <div className="space-y-2">
              <Label>API Key (Global)</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="Cole sua API Key aqui"
              />
            </div>
            <div className="flex items-center gap-2">
              {testSuccess && (
                <Badge className="bg-green-500/20 text-green-500 border-green-500/30">
                  <Wifi className="h-3 w-3 mr-1" /> Conectado
                </Badge>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={handleTestConnection}
                disabled={isTesting || !apiUrl || !apiKey}
                className="flex-1"
              >
                {isTesting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : testSuccess ? (
                  <CheckCircle className="h-4 w-4 mr-2 text-green-500" />
                ) : (
                  <Wifi className="h-4 w-4 mr-2" />
                )}
                Testar Conexão
              </Button>
              <Button
                onClick={() => setStep('instance')}
                disabled={!testSuccess}
                className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white"
              >
                Próximo <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Instance name */}
        {step === 'instance' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da conexão</Label>
              <Input
                value={friendlyName}
                onChange={e => setFriendlyName(e.target.value)}
                placeholder="Ex: Minha Empresa"
              />
              <p className="text-xs text-muted-foreground">
                Slug gerado: <span className="font-mono text-foreground">{generateSlug(friendlyName || 'midas-instance')}</span>
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep('credentials')} className="flex-1">
                Voltar
              </Button>
              <Button
                onClick={handleCreateInstance}
                disabled={isCreating || !friendlyName}
                className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white"
              >
                {isCreating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <QrCode className="h-4 w-4 mr-2" />
                )}
                Gerar QR Code
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: QR Code */}
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
            <Button variant="outline" onClick={handleRefreshQr} className="w-full">
              <RefreshCw className="h-4 w-4 mr-2" /> Atualizar QR Code
            </Button>
          </div>
        )}

        {/* Step 4: Connected */}
        {step === 'connected' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
              <CheckCircle className="h-10 w-10 text-green-500" />
            </div>
            <div className="text-center">
              <p className="font-medium text-lg">WhatsApp conectado!</p>
              <p className="text-sm text-muted-foreground mt-1">
                Sua Evolution API está pronta para enviar reports.
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
