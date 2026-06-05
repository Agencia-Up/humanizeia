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
// NOTA (05/06/2026): a config E honrada pelo pedro-auto-followup (reativacao),
// que checa is_active e PARA na pausa. As funcoes pedro-trigger-followup e
// cron-lead-followup ainda NAO checam is_active (correcao no spec do Douglas,
// Ponto 0). Enquanto isso, "Pausar" silencia a reativacao automatica, mas nao
// os disparos manuais nem a nutricao de 5 min. Os textos abaixo refletem isso.
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
import { Loader2, Clock, MessageSquare, Send, Zap, Info, AlertTriangle, Pause, Play, ShieldCheck, BarChart3 } from 'lucide-react';
import FollowupDashboard from '@/components/pedro/FollowupDashboard';
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
  // Filtro por data de entrada no CRM: so reativa leads criados nos ultimos N
  // dias. null = todos os inativos (sem filtro de data).
  periodo_dias: number | null;
}

const DEFAULT_CONFIG: FollowupIAConfig = {
  // ATIVO por padrao (regra Wander 01/06/2026): is_active=false e o PAUSE
  // global do follow-up. Se o default fosse false, qualquer master que so
  // clicasse "Salvar Configuracao" (sem Iniciar/Ativar) gravaria is_active=false
  // e PAUSARIA o proprio follow-up sem querer (inclusive funis manuais). O
  // pause de verdade so acontece quando o master clica explicitamente "Pausar".
  is_active: true,
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
  periodo_dias: null, // padrao: todos os inativos (sem filtro de data)
};

// Modos do filtro por data (UI). 'todos' = sem filtro (periodo_dias=null).
type DateMode = 'todos' | '7' | '30' | '90' | 'custom';

function periodoToMode(p: number | null | undefined): { mode: DateMode; custom: number } {
  if (p == null) return { mode: 'todos', custom: 60 };
  if (p === 7) return { mode: '7', custom: 60 };
  if (p === 30) return { mode: '30', custom: 60 };
  if (p === 90) return { mode: '90', custom: 60 };
  return { mode: 'custom', custom: p };
}

const DATE_PRESETS: Array<{ key: DateMode; label: string }> = [
  { key: '7', label: 'Últimos 7 dias' },
  { key: '30', label: 'Últimos 30 dias' },
  { key: '90', label: 'Últimos 90 dias' },
  { key: 'custom', label: 'Personalizado' },
  { key: 'todos', label: 'Todos' },
];

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
  const [togglingPause, setTogglingPause] = useState(false);
  const [config, setConfig] = useState<FollowupIAConfig>(DEFAULT_CONFIG);
  const [activeTab, setActiveTab] = useState<'horario' | 'mensagens' | 'disparo' | 'historico'>('horario');
  // UI do filtro por data (deriva de config.periodo_dias).
  const [dateMode, setDateMode] = useState<DateMode>('todos');
  const [customDays, setCustomDays] = useState<number>(60);

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
          const periodo = data.periodo_dias == null ? null : Number(data.periodo_dias);
          const dm = periodoToMode(periodo);
          setDateMode(dm.mode);
          setCustomDays(dm.custom);
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
            periodo_dias: periodo,
          });
        } else {
          setDateMode('todos');
          setCustomDays(60);
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
      periodo_dias: merged.periodo_dias,
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

  // Pausa / ativa o follow-up. Persiste is_active na hora e reflete no estado.
  // Quando PAUSADO (is_active=false), a edge function pedro-trigger-followup
  // nao dispara follow-up pra nenhum lead deste master ("nao dispara pra
  // ninguem"). Quando ATIVO, volta a disparar respeitando as regras.
  const handleTogglePause = async () => {
    const next = !config.is_active;
    setTogglingPause(true);
    try {
      const saved = await persist({ is_active: next });
      if (saved) {
        setConfig(saved);
        toast({
          title: next ? '✅ Follow-up ATIVADO' : '⏸️ Reativação PAUSADA',
          description: next
            ? 'O Pedro voltou a disparar follow-up na coluna de inativos.'
            : 'A reativação automática de leads inativos foi pausada.',
        });
      }
    } finally {
      setTogglingPause(false);
    }
  };

  // Aplica o filtro por data (presets ou personalizado) -> config.periodo_dias.
  // 'todos' = null (sem filtro). 'custom' usa o numero digitado (>=1).
  const applyDateMode = (mode: DateMode, custom?: number) => {
    setDateMode(mode);
    let p: number | null;
    if (mode === 'todos') p = null;
    else if (mode === 'custom') p = Math.max(1, Math.floor(custom ?? customDays) || 1);
    else p = Number(mode);
    setConfig(c => ({ ...c, periodo_dias: p }));
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

        {/* ── Banner de STATUS: Ativo / Pausado + botão de pausar ───────────── */}
        {!loading && (
          <div
            className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
              config.is_active
                ? 'border-emerald-500/40 bg-emerald-500/10'
                : 'border-zinc-500/40 bg-zinc-500/10'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={`relative flex h-2.5 w-2.5 ${config.is_active ? '' : 'opacity-60'}`}
              >
                {config.is_active && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                    config.is_active ? 'bg-emerald-400' : 'bg-zinc-400'
                  }`}
                />
              </span>
              <div>
                <p className={`text-sm font-bold ${config.is_active ? 'text-emerald-300' : 'text-zinc-300'}`}>
                  {config.is_active ? 'Follow-up ATIVO' : 'Follow-up PAUSADO'}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {config.is_active
                    ? 'Disparando na coluna de inativos.'
                    : 'Reativação automática pausada.'}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant={config.is_active ? 'outline' : 'default'}
              onClick={handleTogglePause}
              disabled={togglingPause || saving || starting}
              className={
                config.is_active
                  ? 'h-8 gap-1.5 border-amber-500/40 text-amber-300 hover:bg-amber-500/10'
                  : 'h-8 gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white'
              }
            >
              {togglingPause ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : config.is_active ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {config.is_active ? 'Pausar follow-up' : 'Ativar follow-up'}
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={v => setActiveTab(v as typeof activeTab)} className="mt-2">
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="horario" className="gap-1.5 text-xs">
                <Clock className="h-3.5 w-3.5" /> Horário
              </TabsTrigger>
              <TabsTrigger value="mensagens" className="gap-1.5 text-xs">
                <MessageSquare className="h-3.5 w-3.5" /> Mensagens
              </TabsTrigger>
              <TabsTrigger value="disparo" className="gap-1.5 text-xs">
                <Send className="h-3.5 w-3.5" /> Disparo em Massa
              </TabsTrigger>
              <TabsTrigger value="historico" className="gap-1.5 text-xs">
                <BarChart3 className="h-3.5 w-3.5" /> Histórico
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
              {/* Filtro por data de entrada no CRM */}
              <div className="space-y-2">
                <Label className="text-xs">Filtrar leads por data de entrada no CRM</Label>
                <div className="flex flex-wrap gap-2">
                  {DATE_PRESETS.map(opt => {
                    const selected = dateMode === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => applyDateMode(opt.key)}
                        className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                          selected
                            ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                            : 'border-border/50 bg-card/30 text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                {dateMode === 'custom' && (
                  <div className="flex items-center gap-2 pt-1">
                    <Input
                      type="number" min={1} className="w-24"
                      value={customDays}
                      onChange={e => {
                        const v = Math.max(1, Math.floor(Number(e.target.value) || 1));
                        setCustomDays(v);
                        applyDateMode('custom', v);
                      }}
                    />
                    <span className="text-xs text-muted-foreground">dias atrás</span>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">
                  Só reativa leads que entraram no CRM nesse período.{' '}
                  <strong>Todos</strong> = sem filtro de data (todos os leads inativos).
                </p>
              </div>

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
                  <Label htmlFor="int-min" className="text-xs">Intervalo entre mensagens — mínimo (min)</Label>
                  <Input
                    id="int-min" type="number" min={3}
                    value={config.intervalo_min_minutes}
                    onChange={e => setConfig(c => ({ ...c, intervalo_min_minutes: Math.max(3, Number(e.target.value) || 3) }))}
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

              <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-cyan-100">
                  <strong>Trava de segurança:</strong> o intervalo entre uma mensagem e outra para o mesmo lead
                  nunca fica abaixo de <strong>3 minutos</strong>. Você pode aumentar à vontade, mas
                  não dá pra colocar menos que isso — nem pelo painel, nem por fora. É uma regra fixa pra proteger o número contra bloqueio.
                </p>
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
                  Configurações otimizadas para evitar bloqueios no WhatsApp não-oficial. Quanto maior o intervalo e menor a quantidade/dia, menor o risco de banimento. O piso de 3 min entre mensagens é fixo e não pode ser reduzido.
                </p>
              </div>
            </TabsContent>

            {/* ── Aba 4: Histórico — dashboard de disparos do dia ──────── */}
            <TabsContent value="historico" className="pt-4">
              <FollowupDashboard userId={user?.id} />
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
