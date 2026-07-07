import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, CheckCircle2, Loader2, PlayCircle, Save, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

type SenderCandidate = {
  id: string;
  friendly_name?: string | null;
  phone_number?: string | null;
  status?: string | null;
  is_active?: boolean | null;
  client_name?: string | null;
};

type AuditSettings = {
  enabled?: boolean;
  sender_instance_id?: string | null;
  recipient_phones?: string[];
  last_run_at?: string | null;
  last_summary?: any;
  sender_candidates?: SenderCandidate[];
};

const NONE = '__none__';

function cleanPhone(value: string) {
  let d = String(value || '').replace(/\D/g, '');
  if ((d.length === 10 || d.length === 11) && !d.startsWith('55')) d = `55${d}`;
  return d;
}

function parsePhones(value: string) {
  return Array.from(new Set(
    value
      .split(/[\n,; ]+/)
      .map(cleanPhone)
      .filter((p) => p.length >= 10 && p.length <= 15),
  ));
}

function formatDate(value?: string | null) {
  if (!value) return 'Ainda nao rodou';
  try {
    return new Date(value).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

export default function AdminDailyAuditTab() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [senderId, setSenderId] = useState<string>(NONE);
  const [phonesText, setPhonesText] = useState('');
  const [settings, setSettings] = useState<AuditSettings | null>(null);

  const phones = useMemo(() => parsePhones(phonesText), [phonesText]);
  const candidates = settings?.sender_candidates || [];
  const selectedSender = candidates.find((c) => c.id === senderId);
  const last = settings?.last_summary || null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc('get_platform_daily_audit_settings');
      if (error) throw new Error(error.message);
      const cfg = (data || {}) as AuditSettings;
      setSettings(cfg);
      setEnabled(cfg.enabled === true);
      setSenderId(cfg.sender_instance_id || NONE);
      setPhonesText((cfg.recipient_phones || []).join('\n'));
    } catch (e: any) {
      toast({ title: 'Erro ao carregar auditoria', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const { data, error } = await (supabase as any).rpc('set_platform_daily_audit_settings', {
        p_enabled: enabled,
        p_sender_instance_id: senderId === NONE ? null : senderId,
        p_recipient_phones: phones,
      });
      if (error) throw new Error(error.message);
      const cfg = (data || {}) as AuditSettings;
      setSettings(cfg);
      setEnabled(cfg.enabled === true);
      setSenderId(cfg.sender_instance_id || NONE);
      setPhonesText((cfg.recipient_phones || []).join('\n'));
      toast({ title: 'Auditoria diaria salva', description: 'A rotina das 08:00 foi configurada.' });
    } catch (e: any) {
      toast({ title: 'Erro ao salvar', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('platform-daily-audit', {
        body: { force: true, send_whatsapp: true, source: 'admin_manual' },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Auditoria falhou.');
      toast({
        title: 'Auditoria executada',
        description: `WhatsApp: ${data?.whatsapp?.sent || 0} enviado(s), ${data?.whatsapp?.failed || 0} falha(s).`,
      });
      await load();
    } catch (e: any) {
      toast({ title: 'Erro ao rodar auditoria', description: e?.message, variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando configuracao...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="border-primary/20 bg-card/70">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <BellRing className="h-5 w-5 text-primary" />
                <CardTitle>Auditoria diaria por WhatsApp</CardTitle>
              </div>
              <CardDescription className="mt-2">
                Todo dia as 08:00, o Supabase faz o check-up da Logos e envia o resumo para os ADM.
                A rotina roda no servidor, mesmo com seu computador desligado.
              </CardDescription>
            </div>
            <Badge variant={enabled ? 'default' : 'outline'} className="gap-1">
              {enabled ? <CheckCircle2 className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
              {enabled ? 'Ativa' : 'Desativada'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background/40 p-4">
            <div>
              <Label className="font-semibold">Ativar auditoria diaria</Label>
              <p className="text-xs text-muted-foreground">Quando ativo, dispara automaticamente todos os dias as 08:00.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-2">
              <Label>Numero remetente da auditoria</Label>
              <Select value={senderId} onValueChange={setSenderId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma instancia conectada" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nenhum remetente</SelectItem>
                  {candidates.map((inst) => (
                    <SelectItem key={inst.id} value={inst.id}>
                      {inst.friendly_name || 'Instancia'} · {inst.phone_number || 'sem numero'} · {inst.client_name || 'sem cliente'} · {inst.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Use uma instancia interna/ADM, por exemplo Wander Carvalho ou Douglas. Se ela cair, a auditoria registra o erro mas nao consegue enviar WhatsApp.
              </p>
              {selectedSender && (
                <div className="rounded-md border border-border bg-background/40 p-3 text-xs text-muted-foreground">
                  Selecionado: <span className="font-semibold text-foreground">{selectedSender.friendly_name}</span>
                  {' '}({selectedSender.phone_number || 'sem numero'}) · status {selectedSender.status}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Numeros ADM que recebem o relatorio</Label>
              <textarea
                value={phonesText}
                onChange={(e) => setPhonesText(e.target.value)}
                placeholder="5512999999999&#10;5512988888888"
                className="min-h-[122px] w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm font-mono outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                Um por linha. Validos: {phones.length}. Use DDI 55 + DDD.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div className="text-sm text-muted-foreground">
              Ultima execucao: <span className="font-medium text-foreground">{formatDate(settings?.last_run_at)}</span>
              {last && (
                <span className="ml-2">
                  · {last.checkedInstances || 0} instancias · {last.critical || 0} critico(s) · {last.warnings || 0} alerta(s)
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={runNow} disabled={running || saving}>
                {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
                Rodar agora
              </Button>
              <Button onClick={save} disabled={saving || running}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Salvar configuracao
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">O que a auditoria confere</CardTitle>
          <CardDescription>Correcoes simples sao aplicadas automaticamente; pontos arriscados entram no alerta.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {[
            'Status real das instancias UAZAPI e atualizacao do banco.',
            'WhatsApps desconectados, aguardando QR ou com erro de consulta.',
            'Falhas recentes de IA, chave sem credito ou BYOK ausente.',
            'Transferencias pendentes/presas por mais de 1 hora.',
            'Assinaturas suspensas, canceladas ou vencidas.',
            'Resumo enviado por WhatsApp para os ADM configurados.',
          ].map((item) => (
            <div key={item} className="rounded-md border border-border bg-background/40 p-3 text-sm text-muted-foreground">
              {item}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
