// ============================================================================
// ManagerFeedbackConfigCard — config de entrega de feedbacks pro gerente
// ----------------------------------------------------------------------------
// 2 modos:
//   AUTO: cada feedback é enviado imediatamente pro WhatsApp do gerente
//   AGENDADO: acumula feedbacks e envia em lote no horário escolhido,
//             com delay aleatório entre N mensagens (anti-spam)
// ============================================================================

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Loader2, Save, Bell, Clock, Zap } from 'lucide-react';

interface FeedbackConfig {
  mode: 'auto' | 'scheduled';
  schedule_time_start: string;
  schedule_time_end: string;
  delay_min_seconds: number;
  delay_max_seconds: number;
  last_flushed_at: string | null;
}

const DEFAULT: FeedbackConfig = {
  mode: 'auto',
  schedule_time_start: '09:00',
  schedule_time_end: '09:30',
  delay_min_seconds: 27,
  delay_max_seconds: 54,
  last_flushed_at: null,
};

function trimTime(s: string | null | undefined): string {
  if (!s) return '';
  // Aceita 'HH:MM' ou 'HH:MM:SS' — devolve sempre 'HH:MM'
  return s.slice(0, 5);
}

export function ManagerFeedbackConfigCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [cfg, setCfg] = useState<FeedbackConfig>(DEFAULT);

  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: c } = await (supabase as any)
          .from('manager_feedback_config')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();
        if (cancelled) return;
        if (c) {
          setCfg({
            mode: c.mode || 'auto',
            schedule_time_start: trimTime(c.schedule_time_start) || DEFAULT.schedule_time_start,
            schedule_time_end: trimTime(c.schedule_time_end) || DEFAULT.schedule_time_end,
            delay_min_seconds: c.delay_min_seconds ?? DEFAULT.delay_min_seconds,
            delay_max_seconds: c.delay_max_seconds ?? DEFAULT.delay_max_seconds,
            last_flushed_at: c.last_flushed_at || null,
          });
        }
        // Conta feedbacks pendentes
        const { count } = await (supabase as any)
          .from('pedro_manager_feedback')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('pending_send', true);
        if (!cancelled) setPendingCount(count || 0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const handleSave = async () => {
    if (!userId) return;
    if (cfg.delay_min_seconds <= 0 || cfg.delay_max_seconds < cfg.delay_min_seconds) {
      toast({ title: 'Delays inválidos', description: 'Min > 0 e Max >= Min.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from('manager_feedback_config')
        .upsert({
          user_id: userId,
          mode: cfg.mode,
          schedule_time_start: cfg.schedule_time_start,
          schedule_time_end: cfg.schedule_time_end,
          delay_min_seconds: cfg.delay_min_seconds,
          delay_max_seconds: cfg.delay_max_seconds,
        }, { onConflict: 'user_id' });
      if (error) throw error;
      toast({
        title: '✅ Configuração salva',
        description: cfg.mode === 'auto'
          ? 'Feedbacks serão enviados imediatamente pro gerente.'
          : `Feedbacks acumularão e serão enviados entre ${cfg.schedule_time_start} e ${cfg.schedule_time_end}.`,
      });
    } catch (err: any) {
      toast({ title: 'Erro ao salvar', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const isScheduled = cfg.mode === 'scheduled';

  return (
    <Card className="border-blue-500/20 bg-gradient-to-br from-blue-500/5 to-cyan-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4 text-blue-400" />
              Entrega de Feedbacks ao Gerente
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Define quando os feedbacks dos vendedores chegam no WhatsApp do gerente.
            </CardDescription>
          </div>
          {pendingCount > 0 && (
            <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400">
              {pendingCount} pendente{pendingCount === 1 ? '' : 's'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Toggle modo */}
        <div className="flex items-start justify-between gap-3 p-3 rounded-md border border-border/40 bg-background/50">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              {isScheduled ? <Clock className="h-3.5 w-3.5 text-blue-400" /> : <Zap className="h-3.5 w-3.5 text-amber-400" />}
              <Label className="text-sm font-medium">
                {isScheduled ? 'Modo Agendado (lote diário)' : 'Modo Automático (envio imediato)'}
              </Label>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {isScheduled
                ? 'Feedbacks acumulam e são enviados todos juntos numa janela horária, com delay anti-spam.'
                : 'Cada feedback é enviado pro gerente assim que o vendedor preenche.'}
            </p>
          </div>
          <Switch
            checked={isScheduled}
            onCheckedChange={(v) => setCfg({ ...cfg, mode: v ? 'scheduled' : 'auto' })}
          />
        </div>

        {/* Config do modo agendado */}
        {isScheduled && (
          <div className="space-y-3 p-3 rounded-md border border-border/40 bg-background/30">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Horário início (envio)</Label>
                <Input
                  type="time"
                  value={cfg.schedule_time_start}
                  onChange={(e) => setCfg({ ...cfg, schedule_time_start: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Horário fim (limite)</Label>
                <Input
                  type="time"
                  value={cfg.schedule_time_end}
                  onChange={(e) => setCfg({ ...cfg, schedule_time_end: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1">
              Janela em que o cron processa o lote (timezone São Paulo). Se cair fora dessa janela, o envio acontece no dia seguinte.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Delay mín entre msgs (s)</Label>
                <Input
                  type="number"
                  min={1}
                  max={300}
                  value={cfg.delay_min_seconds}
                  onChange={(e) => setCfg({ ...cfg, delay_min_seconds: Number(e.target.value) })}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Delay máx entre msgs (s)</Label>
                <Input
                  type="number"
                  min={1}
                  max={600}
                  value={cfg.delay_max_seconds}
                  onChange={(e) => setCfg({ ...cfg, delay_max_seconds: Number(e.target.value) })}
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1">
              Cada mensagem é separada por um delay aleatório nesse intervalo (anti-spam WhatsApp). Padrão: 27–54s.
            </p>

            {cfg.last_flushed_at && (
              <p className="text-[10px] text-muted-foreground">
                Último envio em lote: {new Date(cfg.last_flushed_at).toLocaleString('pt-BR')}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} size="sm" className="gap-1.5 text-xs">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Salvar Configuração
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
