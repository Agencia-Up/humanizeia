// ============================================================================
// FollowupIAConfigModal
// ----------------------------------------------------------------------------
// Fase 1 do plano "Follow-up IA" — modal de configuração do disparo automático
// de reativação de leads inativos pelo agente Pedro.
//
// 3 abas (spec 27/05/2026):
//  1. Horário de Disparo — janela inicio/fim + dias da semana
//  2. Configuração de Mensagens — template base + toggle "gerar variações IA"
//  3. Disparo em Massa — qtd/dia, intervalo min/max, simular humano
//
// Persiste em public.followup_ia_config (1 row por master, UNIQUE user_id).
// Tabela criada na migration 20260527230000_followup_ia_config.sql.
//
// CRÍTICO: este modal SÓ persiste configuração. A APLICAÇÃO desses settings na
// edge function pedro-trigger-followup vem nas Fases 2+. Por enquanto, salvar
// não muda comportamento atual do disparo.
// ============================================================================

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Clock, MessageSquare, Send, Zap, Info, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface FollowupIAConfig {
  is_active: boolean;
  horario_inicio: string; // 'HH:MM'
  horario_fim: string;    // 'HH:MM'
  dias_semana: number[];  // 0=dom ... 6=sab
  mensagem_base: string;
  gerar_variacoes_ia: boolean;
  max_disparos_dia: number;
  intervalo_min_minutes: number;
  intervalo_max_minutes: number;
  simular_humano: boolean;
}

const DEFAULT_CONFIG: FollowupIAConfig = {
  is_active: false,
  horario_inicio: '08:00',
  horario_fim: '19:00',
  dias_semana: [1, 2, 3, 4, 5],
  mensagem_base:
    'Oi {nome}, tudo bem? Vi que vc esteve aqui há uns dias atrás procurando um carro e queria saber se ainda está interessado. Posso te ajudar?',
  gerar_variacoes_ia: true,
  max_disparos_dia: 10,
  intervalo_min_minutes: 15,
  intervalo_max_minutes: 45,
  simular_humano: true,
};

const DIAS_LABELS: Array<{ id: number; short: string; long: string }> = [
  { id: 1, short: 'Seg', long: 'Segunda' },
  { id: 2, short: 'Ter', long: 'Terça' },
  { id: 3, short: 'Qua', long: 'Quarta' },
  { id: 4, short: 'Qui', long: 'Quinta' },
  { id: 5, short: 'Sex', long: 'Sexta' },
  { id: 6, short: 'Sáb', long: 'Sábado' },
  { id: 0, short: 'Dom', long: 'Domingo' },
];

// ─── Props ──────────────────────────────────────────────────────────────────

export interface FollowupIAConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Callback chamado quando user clica "Iniciar Follow-up agora".
   * Recebe a config salva. PedroSDR vai usar isso pra chamar
   * pedro-trigger-followup (comportamento atual mantido na Fase 1).
   */
  onStartFollowup?: (config: FollowupIAConfig) => Promise<void> | void;
}

// ─── Componente ─────────────────────────────────────────────────────────────

export function FollowupIAConfigModal({
  open, onOpenChange, onStartFollowup,
}: FollowupIAConfigModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [config, setConfig] = useState<FollowupIAConfig>(DEFAULT_CONFIG);
  const [activeTab, setActiveTab] = useState<'horario' | 'mensagens' | 'disparo'>('horario');

  // ── Carrega config quando o modal abre ──────────────────────────────────
  useEffect(() => {
    if (!open || !user?.id) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await (supabase as any)
          .from('followup_ia_config')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          console.error('[FollowupIAConfigModal] erro ao carregar config:', error);
          setConfig(DEFAULT_CONFIG);
          return;
        }
        if (data) {
          // Converte time do Postgres ('HH:MM:SS') pro <input type="time"> ('HH:MM')
          const toHHMM = (t: string | null | undefined) =>
            t ? t.slice(0, 5) : '08:00';
          setConfig({
            is_active: !!data.is_active,
            horario_inicio: toHHMM(data.horario_inicio),
            horario_fim: toHHMM(data.horario_fim),
            dias_semana: Array.isArray(data.dias_semana) ? data.dias_semana : [1, 2, 3, 4, 5],
            mensagem_base: data.mensagem_base || DEFAULT_CONFIG.mensagem_base,
            gerar_variacoes_ia: !!data.gerar_variacoes_ia,
            max_disparos_dia: Number(data.max_disparos_dia) || 10,
            intervalo_min_minutes: Number(data.intervalo_min_minutes) || 15,
            intervalo_max_minutes: Number(data.intervalo_max_minutes) || 45,
            simular_humano: !!data.simular_humano,
          });
        } else {
          setConfig(DEFAULT_CONFIG);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, user?.id]);

  // ── Validações de input ─────────────────────────────────────────────────
  const horarioInvalido = config.horario_inicio >= config.horario_fim;
  const intervaloInvalido = config.intervalo_min_minutes > config.intervalo_max_minutes;
  const semDias = config.dias_semana.length === 0;
  const validacaoErros: string[] = [];
  if (horarioInvalido) validacaoErros.push('Horário de início deve ser antes do fim.');
  if (intervaloInvalido) validacaoErros.push('Intervalo mínimo não pode ser maior que o máximo.');
  if (semDias) validacaoErros.push('Selecione ao menos 1 dia da semana.');

  const persist = async (extra?: Partial<FollowupIAConfig>): Promise<FollowupIAConfig | null> => {
    if (!user?.id) {
      toast({ title: 'Erro', description: 'Usuário não autenticado.', variant: 'destructive' });
      return null;
    }
    const merged = { ...config, ...(extra || {}) };
    const payload = {
      user_id: user.id,
      is_active: merged.is_active,
      horario_inicio: merged.horario_inicio + ':00',
      horario_fim: merged.horario_fim + ':00',
      dias_semana: merged.dias_semana,
      mensagem_base: merged.mensagem_base,
      gerar_variacoes_ia: merged.gerar_variacoes_ia,
      max_disparos_dia: merged.max_disparos_dia,
      intervalo_min_minutes: merged.intervalo_min_minutes,
      intervalo_max_minutes: merged.intervalo_max_minutes,
      simular_humano: merged.simular_humano,
    };
    const { error } = await (supabase as any)
      .from('followup_ia_config')
      .upsert(payload, { onConflict: 'user_id' });
    if (error) {
      console.error('[FollowupIAConfigModal] erro ao salvar:', error);
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
      return null;
    }
    return merged;
  };

  const handleSave = async () => {
    if (validacaoErros.length > 0) {
      toast({ title: 'Validação', description: validacaoErros.join(' '), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const saved = await persist();
      if (saved) {
        toast({ title: '✅ Configuração salva' });
        onOpenChange(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleStartNow = async () => {
    if (validacaoErros.length > 0) {
      toast({ title: 'Validação', description: validacaoErros.join(' '), variant: 'destructive' });
      return;
    }
    setStarting(true);
    try {
      // Ao iniciar, marca como ativo + dispara
      const saved = await persist({ is_active: true });
      if (!saved) return;
      setConfig(saved);
      if (onStartFollowup) {
        await onStartFollowup(saved);
      }
      onOpenChange(false);
    } finally {
      setStarting(false);
    }
  };

  const toggleDia = (id: number, checked: boolean) => {
    setConfig(prev => ({
      ...prev,
      dias_semana: checked
        ? [...prev.dias_semana, id].sort((a, b) => a - b)
        : prev.dias_semana.filter(d => d !== id),
    }));
  };

  // Preview placeholder (na Fase 3 será gerado pela IA com contexto real)
  const previewMensagem = config.mensagem_base
    .replace(/\{nome\}/g, 'João')
    .replace(/\{carro\}/g, 'Onix LT 2022');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-cyan-400" />
            Follow-up IA — Configuração
          </DialogTitle>
          <DialogDescription>
            Define como o agente Pedro vai disparar mensagens de reativação para leads inativos.
            Configurações otimizadas para evitar bloqueios no WhatsApp não-oficial.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={v => setActiveTab(v as typeof activeTab)} className="mt-2">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="horario" className="gap-1.5 text-xs">
                <Clock className="h-3.5 w-3.5" /> Horário
              </TabsTrigger>
              <TabsTrigger value="mensagens" className="gap-1.5 text-xs">
                <MessageSquare className="h-3.5 w-3.5" /> Mensagens
              </TabsTrigger>
              <TabsTrigger value="disparo" className="gap-1.5 text-xs">
                <Send className="h-3.5 w-3.5" /> Disparo em Massa
              </TabsTrigger>
            </TabsList>

            {/* ── Aba 1: Horário ─────────────────────────────────────── */}
            <TabsContent value="horario" className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="hr-inicio" className="text-xs">Horário de início</Label>
                  <Input
                    id="hr-inicio" type="time"
                    value={config.horario_inicio}
                    onChange={e => setConfig(c => ({ ...c, horario_inicio: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hr-fim" className="text-xs">Horário de fim</Label>
                  <Input
                    id="hr-fim" type="time"
                    value={config.horario_fim}
                    onChange={e => setConfig(c => ({ ...c, horario_fim: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Dias da semana</Label>
                <div className="grid grid-cols-7 gap-2">
                  {DIAS_LABELS.map(dia => {
                    const checked = config.dias_semana.includes(dia.id);
                    return (
                      <label
                        key={dia.id}
                        className={`flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 cursor-pointer text-xs transition-colors ${
                          checked
                            ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                            : 'border-border/50 bg-card/30 text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => toggleDia(dia.id, !!v)}
                          className="h-3 w-3"
                        />
                        <span className="font-semibold">{dia.short}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>Fuso horário da conta: <strong>America/Sao_Paulo (UTC-3)</strong>. Dias selecionados: <strong>{config.dias_semana.length} de 7</strong>.</span>
              </div>
            </TabsContent>

            {/* ── Aba 2: Mensagens ──────────────────────────────────── */}
            <TabsContent value="mensagens" className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="msg-base" className="text-xs">Mensagem de reativação (base)</Label>
                <Textarea
                  id="msg-base" rows={4}
                  value={config.mensagem_base}
                  onChange={e => setConfig(c => ({ ...c, mensagem_base: e.target.value }))}
                  placeholder="Oi {nome}, tudo bem? ..."
                />
                <p className="text-[10px] text-muted-foreground">
                  Use <code className="bg-muted/50 rounded px-1">{'{nome}'}</code> e <code className="bg-muted/50 rounded px-1">{'{carro}'}</code> como variáveis. A IA usará isso como referência se as variações automáticas estiverem ativas.
                </p>
              </div>

              <div className="flex items-start justify-between gap-3 rounded-lg border border-border/50 p-3">
                <div>
                  <Label htmlFor="toggle-ia" className="text-sm font-semibold">Gerar variações automáticas por lead</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Cada lead receberá uma mensagem diferente e personalizada para evitar bloqueios.
                  </p>
                </div>
                <Switch
                  id="toggle-ia"
                  checked={config.gerar_variacoes_ia}
                  onCheckedChange={v => setConfig(c => ({ ...c, gerar_variacoes_ia: v }))}
                />
              </div>

              <div className="rounded-lg border border-dashed border-cyan-500/30 bg-cyan-500/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-cyan-300 font-bold mb-1">Preview</p>
                <p className="text-sm text-foreground italic">
                  {previewMensagem}
                </p>
                {config.gerar_variacoes_ia && (
                  <p className="text-[10px] text-muted-foreground mt-2">
                    💡 Quando o disparo IA estiver ativo, esse preview será substituído pela mensagem real gerada pelo Claude com base no histórico do lead.
                  </p>
                )}
              </div>
            </TabsContent>

            {/* ── Aba 3: Disparo em Massa ───────────────────────────── */}
            <TabsContent value="disparo" className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="max-dia" className="text-xs">Quantidade de disparos por dia</Label>
                <Input
                  id="max-dia" type="number" min={1} max={30}
                  value={config.max_disparos_dia}
                  onChange={e => setConfig(c => ({ ...c, max_disparos_dia: Math.min(30, Math.max(1, Number(e.target.value) || 1)) }))}
                />
                <p className="text-[10px] text-muted-foreground">Entre 1 e 30 disparos/dia. Padrão: 10.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="int-min" className="text-xs">Intervalo mínimo (min)</Label>
                  <Input
                    id="int-min" type="number" min={10}
                    value={config.intervalo_min_minutes}
                    onChange={e => setConfig(c => ({ ...c, intervalo_min_minutes: Math.max(10, Number(e.target.value) || 10) }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="int-max" className="text-xs">Intervalo máximo (min)</Label>
                  <Input
                    id="int-max" type="number" min={config.intervalo_min_minutes}
                    value={config.intervalo_max_minutes}
                    onChange={e => setConfig(c => ({ ...c, intervalo_max_minutes: Number(e.target.value) || 45 }))}
                  />
                </div>
              </div>

              <div className="flex items-start justify-between gap-3 rounded-lg border border-border/50 p-3">
                <div>
                  <Label htmlFor="toggle-humano" className="text-sm font-semibold">Simular comportamento humano</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Adiciona variação aleatória nos intervalos pra não parecer automático.
                  </p>
                </div>
                <Switch
                  id="toggle-humano"
                  checked={config.simular_humano}
                  onCheckedChange={v => setConfig(c => ({ ...c, simular_humano: v }))}
                />
              </div>

              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-200">
                  Configurações otimizadas para evitar bloqueios no WhatsApp não-oficial. Valores muito agressivos (intervalo &lt; 10min, &gt; 30/dia) aumentam o risco de banimento.
                </p>
              </div>
            </TabsContent>
          </Tabs>
        )}

        {validacaoErros.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {validacaoErros.join(' ')}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || starting}>
            Cancelar
          </Button>
          <Button variant="secondary" onClick={handleSave} disabled={saving || starting || validacaoErros.length > 0}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Salvar configurações
          </Button>
          <Button
            onClick={handleStartNow}
            disabled={saving || starting || validacaoErros.length > 0}
            className="bg-cyan-500 hover:bg-cyan-600 text-white"
          >
            {starting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
            Iniciar Follow-up agora
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default FollowupIAConfigModal;
