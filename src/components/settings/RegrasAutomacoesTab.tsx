import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlugZap, Save, Loader2, Clock, MessageSquareText, ArrowRightLeft, FileClock, Users, Plus, Target } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

// Reconexão + relatório de atendimento: sem linha => defaults = comportamento legado.
const DEFAULTS = {
  reconexao_enabled: true, reconexao_intervalo_min: 60, reconexao_hora_ini: 7, reconexao_hora_fim: 21,
  relatorio_atendimento_enabled: true, relatorio_atendimento_hora: 8,
};
const INTERVALOS = [
  { v: 30, l: '30 minutos' }, { v: 60, l: '1 hora' }, { v: 120, l: '2 horas' },
  { v: 180, l: '3 horas' }, { v: 360, l: '6 horas' }, { v: 720, l: '12 horas' },
];
const horas = Array.from({ length: 24 }, (_, i) => i);

// Follow-up/transfer: mesmos defaults/shape do _shared/automation/rules.ts.
const FU_DEFAULT = { enabled: true, t1: 5, t2: 8, t3: 12, t3_transfers: true };
const TR_DEFAULT = { enabled: true, seller_min: 10, window_custom: false, start: '10:11', end: '19:29' };

export function RegrasAutomacoesTab() {
  const { user } = useAuth();
  const { toast } = useToast();

  // ── Reconexão (config de conta) ──
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingRel, setSavingRel] = useState(false);
  const [cfg, setCfg] = useState(DEFAULTS);

  // ── Destinatários do relatório de atendimento (conta_responsaveis.recebe_atendimento) ──
  const [resp, setResp] = useState<any[]>([]);
  const [loadingResp, setLoadingResp] = useState(true);
  const [novoNome, setNovoNome] = useState('');
  const [novoWa, setNovoWa] = useState('');
  const [addingResp, setAddingResp] = useState(false);

  // ── Follow-up / Transferência (por agente, em wa_ai_agents.automation_rules) ──
  const [agents, setAgents] = useState<any[]>([]);
  const [agentId, setAgentId] = useState('');
  const [loadingAg, setLoadingAg] = useState(true);
  const [savingAg, setSavingAg] = useState(false);
  const [fu, setFu] = useState(FU_DEFAULT);
  const [tr, setTr] = useState(TR_DEFAULT);

  // ── Relatório do José (Fluxo A — apollo_cron_config, por conta) ──
  // Só mexemos nos campos DO RELATÓRIO (send_daily_report / run_hour / run_minute /
  // whatsapp_report_number). NÃO tocamos em is_enabled/auto_execute/account_id — isso
  // é a autonomia do agente José e sai do escopo desta aba.
  const [jose, setJose] = useState<any>(null); // null = sem linha (José não configurado)
  const [loadingJose, setLoadingJose] = useState(true);
  const [savingJose, setSavingJose] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from('conta_automacao_regras')
        .select('reconexao_enabled, reconexao_intervalo_min, reconexao_hora_ini, reconexao_hora_fim, relatorio_atendimento_enabled, relatorio_atendimento_hora')
        .eq('user_id', user.id).maybeSingle();
      if (!cancelled) { setCfg(data ? { ...DEFAULTS, ...data } : DEFAULTS); setLoading(false); }
    })();
    (async () => {
      setLoadingResp(true);
      const { data } = await (supabase as any)
        .from('conta_responsaveis')
        .select('id, nome, whatsapp, recebe_atendimento, ativo')
        .eq('user_id', user.id).order('created_at', { ascending: true });
      if (!cancelled) { setResp(Array.isArray(data) ? data : []); setLoadingResp(false); }
    })();
    (async () => {
      setLoadingAg(true);
      const { data } = await (supabase as any)
        .from('wa_ai_agents')
        .select('id, name, automation_rules')
        .eq('user_id', user.id).order('created_at', { ascending: true });
      if (cancelled) return;
      const list = Array.isArray(data) ? data : [];
      setAgents(list);
      if (list.length > 0) setAgentId((prev) => prev || list[0].id);
      setLoadingAg(false);
    })();
    (async () => {
      setLoadingJose(true);
      const { data } = await (supabase as any)
        .from('apollo_cron_config')
        .select('id, is_enabled, send_daily_report, run_hour, run_minute, timezone, whatsapp_report_number')
        .eq('user_id', user.id).maybeSingle();
      if (!cancelled) { setJose(data || null); setLoadingJose(false); }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Carrega as regras do agente selecionado nos campos.
  useEffect(() => {
    const a = agents.find((x) => x.id === agentId);
    if (!a) return;
    const ar: any = a.automation_rules || {};
    const arF: any = ar.followup || {}; const arT: any = ar.transfer || {};
    setFu({
      enabled: arF.enabled !== false,
      t1: Number(arF.t1_min) > 0 ? Number(arF.t1_min) : 5,
      t2: Number(arF.t2_min) > 0 ? Number(arF.t2_min) : 8,
      t3: Number(arF.t3_min) > 0 ? Number(arF.t3_min) : 12,
      t3_transfers: arF.t3_transfers !== false,
    });
    setTr({
      enabled: arT.enabled !== false,
      seller_min: Number(arT.seller_response_min) > 0 ? Number(arT.seller_response_min) : 10,
      window_custom: !!arT.window,
      start: arT.window?.start || '10:11',
      end: arT.window?.end || '19:29',
    });
  }, [agentId, agents]);

  const salvarReconexao = async () => {
    if (!user?.id) return;
    if (cfg.reconexao_hora_fim <= cfg.reconexao_hora_ini) {
      toast({ title: 'Janela inválida', description: 'A hora final precisa ser maior que a inicial.', variant: 'destructive' }); return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from('conta_automacao_regras')
      .upsert({ user_id: user.id, ...cfg, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    setSaving(false);
    error ? toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' })
          : toast({ title: '✅ Regra salva', description: 'O lembrete de reconexão foi atualizado.' });
  };

  // Salva a config do relatório de atendimento (mesma linha da conta; upserta cfg inteiro
  // pra não zerar a reconexão). O cron roda de hora em hora e dispara na hora configurada.
  const salvarRelatorioAtendimento = async () => {
    if (!user?.id) return;
    setSavingRel(true);
    const { error } = await (supabase as any).from('conta_automacao_regras')
      .upsert({ user_id: user.id, ...cfg, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    setSavingRel(false);
    error ? toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' })
          : toast({ title: '✅ Relatório atualizado', description: 'Horário e envio do relatório de atendimento salvos.' });
  };

  // Liga/desliga um responsável no relatório de atendimento (só mexe em recebe_atendimento).
  const toggleRecebe = async (id: string, val: boolean) => {
    setResp((prev) => prev.map((r) => r.id === id ? { ...r, recebe_atendimento: val } : r));
    const { error } = await (supabase as any).from('conta_responsaveis')
      .update({ recebe_atendimento: val, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) {
      setResp((prev) => prev.map((r) => r.id === id ? { ...r, recebe_atendimento: !val } : r));
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    }
  };

  // Adiciona um destinatário (mesmo padrão do ResponsaveisTab: upsert por user_id+whatsapp).
  const addResp = async () => {
    if (!user?.id) return;
    const wa = novoWa.replace(/\D/g, '');
    if (!novoNome.trim() || wa.length < 10) {
      toast({ title: 'Dados incompletos', description: 'Informe nome e um WhatsApp válido (com DDD).', variant: 'destructive' }); return;
    }
    setAddingResp(true);
    const { error } = await (supabase as any).from('conta_responsaveis')
      .upsert({ user_id: user.id, nome: novoNome.trim(), whatsapp: wa, recebe_atendimento: true, ativo: true, updated_at: new Date().toISOString() }, { onConflict: 'user_id,whatsapp' });
    if (error) { setAddingResp(false); toast({ title: 'Erro ao adicionar', description: error.message, variant: 'destructive' }); return; }
    const { data } = await (supabase as any).from('conta_responsaveis')
      .select('id, nome, whatsapp, recebe_atendimento, ativo')
      .eq('user_id', user.id).order('created_at', { ascending: true });
    setResp(Array.isArray(data) ? data : []);
    setNovoNome(''); setNovoWa(''); setAddingResp(false);
    toast({ title: '✅ Destinatário adicionado', description: `${novoNome.trim()} vai receber o relatório de atendimento.` });
  };

  // Salva SÓ os campos do relatório do José (Fluxo A). Nunca toca em is_enabled/auto_execute.
  const salvarJose = async () => {
    if (!user?.id || !jose) return;
    const wa = String(jose.whatsapp_report_number || '').replace(/\D/g, '');
    if (jose.send_daily_report && wa.length < 10) {
      toast({ title: 'WhatsApp inválido', description: 'Informe o número (com DDD) que recebe o relatório do José.', variant: 'destructive' }); return;
    }
    const hour = Math.min(23, Math.max(0, Math.round(Number(jose.run_hour)) || 0));
    const minute = Math.min(59, Math.max(0, Math.round(Number(jose.run_minute)) || 0));
    setSavingJose(true);
    const { error } = await (supabase as any).from('apollo_cron_config')
      .update({ send_daily_report: !!jose.send_daily_report, run_hour: hour, run_minute: minute, whatsapp_report_number: wa || jose.whatsapp_report_number })
      .eq('user_id', user.id);
    setSavingJose(false);
    if (error) { toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' }); return; }
    setJose((j: any) => ({ ...j, run_hour: hour, run_minute: minute, whatsapp_report_number: wa || j.whatsapp_report_number }));
    toast({ title: '✅ Relatório do José atualizado', description: 'Vale a partir do próximo ciclo diário.' });
  };

  const salvarAgente = async () => {
    if (!agentId) return;
    // Mesmo shape/clamp do AgentFormDialog (fonte que os motores já leem).
    const t1 = Math.max(1, Math.round(Number(fu.t1)) || 5);
    const t2 = Math.max(t1 + 1, Math.round(Number(fu.t2)) || 8);
    const t3 = Math.max(t2 + 1, Math.round(Number(fu.t3)) || 12);
    const rules = {
      followup: { enabled: fu.enabled, t1_min: t1, t2_min: t2, t3_min: t3, t3_transfers: fu.t3_transfers },
      transfer: {
        enabled: tr.enabled,
        seller_response_min: Math.max(1, Math.round(Number(tr.seller_min)) || 10),
        window: tr.window_custom ? { enabled: true, start: tr.start, end: tr.end } : null,
      },
    };
    setSavingAg(true);
    const { error } = await (supabase as any).from('wa_ai_agents')
      .update({ automation_rules: rules, updated_at: new Date().toISOString() }).eq('id', agentId);
    setSavingAg(false);
    if (error) { toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' }); return; }
    setAgents((prev) => prev.map((a) => a.id === agentId ? { ...a, automation_rules: rules } : a));
    // reflete o clamp de volta nos campos
    setFu((f) => ({ ...f, t1, t2, t3 }));
    toast({ title: '✅ Regras salvas', description: 'Follow-up e transferência atualizados para este agente.' });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Regras & Automações</h2>
        <p className="text-sm text-muted-foreground">
          Controle as regras automáticas da plataforma: liga/desliga, tempos e horários. As mudanças valem para toda a sua conta.
        </p>
      </div>

      {/* ── Reconexão do vendedor ── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                <PlugZap className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <CardTitle className="text-base">Lembrete de reconexão do vendedor</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Quando o WhatsApp de um vendedor cai, a plataforma manda um lembrete pra ele reconectar. Aqui você define se envia, de quanto em quanto tempo e em qual horário.
                </CardDescription>
              </div>
            </div>
            <Switch checked={cfg.reconexao_enabled} onCheckedChange={(v) => setCfg((c) => ({ ...c, reconexao_enabled: v }))} disabled={loading} />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
          ) : (
            <>
              <div className={cfg.reconexao_enabled ? '' : 'opacity-50 pointer-events-none'}>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs">Repetir o lembrete a cada</Label>
                    <Select value={String(cfg.reconexao_intervalo_min)} onValueChange={(v) => setCfg((c) => ({ ...c, reconexao_intervalo_min: Number(v) }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{INTERVALOS.map((i) => <SelectItem key={i.v} value={String(i.v)}>{i.l}</SelectItem>)}</SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">Só reenvia enquanto o vendedor continuar desconectado.</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Só enviar entre (horário de Brasília)</Label>
                    <div className="flex items-center gap-2">
                      <Select value={String(cfg.reconexao_hora_ini)} onValueChange={(v) => setCfg((c) => ({ ...c, reconexao_hora_ini: Number(v) }))}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>{horas.map((h) => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</SelectItem>)}</SelectContent>
                      </Select>
                      <span className="text-muted-foreground text-sm">até</span>
                      <Select value={String(cfg.reconexao_hora_fim)} onValueChange={(v) => setCfg((c) => ({ ...c, reconexao_hora_fim: Number(v) }))}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>{horas.filter((h) => h >= 1).map((h) => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Fora dessa janela nenhum lembrete é enviado.</p>
                  </div>
                </div>
              </div>
              {!cfg.reconexao_enabled && <p className="text-xs text-amber-500">Desligado: nenhum lembrete de reconexão será enviado aos vendedores.</p>}
              <div className="flex justify-end">
                <Button onClick={salvarReconexao} disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Seletor de agente (follow-up + transferência são por agente) ── */}
      {!loadingAg && agents.length === 0 ? (
        <Card className="border-dashed"><CardContent className="py-4">
          <p className="text-xs text-muted-foreground">Nenhum agente de IA configurado ainda. Crie um agente em <span className="font-medium text-foreground">WhatsApp → Agente IA</span> para configurar follow-up e transferência aqui.</p>
        </CardContent></Card>
      ) : (
        <>
          {agents.length > 1 && (
            <div className="flex items-center gap-3">
              <Label className="text-xs text-muted-foreground">Agente:</Label>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                <SelectContent>{agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name || 'Agente'}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}

          {/* ── Follow-up da IA ── */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 border border-violet-500/30">
                    <MessageSquareText className="h-5 w-5 text-violet-400" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Follow-up da IA</CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      Quando o cliente para de responder, a IA reengaja em 2 tempos e, no 3º, transfere pra um vendedor. Ajuste os minutos de cada etapa.
                    </CardDescription>
                  </div>
                </div>
                <Switch checked={fu.enabled} onCheckedChange={(v) => setFu((f) => ({ ...f, enabled: v }))} disabled={loadingAg} />
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {loadingAg ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
              ) : (
                <>
                  <div className={fu.enabled ? '' : 'opacity-50 pointer-events-none'}>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label className="text-xs">1ª mensagem (min. de inatividade)</Label>
                        <Input type="number" min={1} value={fu.t1} onChange={(e) => setFu((f) => ({ ...f, t1: Number(e.target.value) }))} />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">2ª mensagem (min.)</Label>
                        <Input type="number" min={1} value={fu.t2} onChange={(e) => setFu((f) => ({ ...f, t2: Number(e.target.value) }))} />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Transferir pro vendedor (min.)</Label>
                        <Input type="number" min={1} value={fu.t3} onChange={(e) => setFu((f) => ({ ...f, t3: Number(e.target.value) }))} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-4 rounded-lg border border-border/40 bg-background/40 px-3 py-2">
                      <Label className="text-xs">No 3º tempo, transferir para um vendedor</Label>
                      <Switch checked={fu.t3_transfers} onCheckedChange={(v) => setFu((f) => ({ ...f, t3_transfers: v }))} />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-2">A ordem é corrigida automaticamente (1ª &lt; 2ª &lt; transferência).</p>
                  </div>
                  {!fu.enabled && <p className="text-xs text-amber-500">Desligado: a IA não fará follow-up automático dos clientes inativos.</p>}
                  <div className="flex justify-end">
                    <Button onClick={salvarAgente} disabled={savingAg} className="gap-2">
                      {savingAg ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ── Transferência pro próximo vendedor ── */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/30">
                    <ArrowRightLeft className="h-5 w-5 text-blue-400" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Transferência para o próximo vendedor</CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      Se o vendedor não confirmar o lead a tempo, o sistema repassa para o próximo da fila. Defina o tempo de confirmação e a janela de horário do repasse.
                    </CardDescription>
                  </div>
                </div>
                <Switch checked={tr.enabled} onCheckedChange={(v) => setTr((t) => ({ ...t, enabled: v }))} disabled={loadingAg} />
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {!loadingAg && (
                <>
                  <div className={tr.enabled ? '' : 'opacity-50 pointer-events-none'}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label className="text-xs">Tempo pro vendedor confirmar (min.)</Label>
                        <Input type="number" min={1} value={tr.seller_min} onChange={(e) => setTr((t) => ({ ...t, seller_min: Number(e.target.value) }))} />
                        <p className="text-[11px] text-muted-foreground">Sem confirmação nesse tempo, o lead passa pro próximo.</p>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Janela de horário do repasse</Label>
                          <Switch checked={tr.window_custom} onCheckedChange={(v) => setTr((t) => ({ ...t, window_custom: v }))} />
                        </div>
                        {tr.window_custom ? (
                          <div className="flex items-center gap-2">
                            <Input type="time" value={tr.start} onChange={(e) => setTr((t) => ({ ...t, start: e.target.value }))} />
                            <span className="text-muted-foreground text-sm">até</span>
                            <Input type="time" value={tr.end} onChange={(e) => setTr((t) => ({ ...t, end: e.target.value }))} />
                          </div>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">Usando a janela padrão da plataforma (seg–sex 10:11–19:29; sáb/dom reduzida). Ligue pra personalizar.</p>
                        )}
                      </div>
                    </div>
                  </div>
                  {!tr.enabled && <p className="text-xs text-amber-500">Desligado: leads não são repassados automaticamente ao próximo vendedor.</p>}
                  <div className="flex justify-end">
                    <Button onClick={salvarAgente} disabled={savingAg} className="gap-2">
                      {savingAg ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ── Relatório de atendimento (feedback diário no WhatsApp) ── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/30">
                <FileClock className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <CardTitle className="text-base">Relatório de atendimento</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Todo dia a plataforma envia no WhatsApp o resumo do atendimento (funil + gargalo + por vendedor). Aqui você define se envia, a que horas e quem recebe.
                </CardDescription>
              </div>
            </div>
            <Switch checked={cfg.relatorio_atendimento_enabled} onCheckedChange={(v) => setCfg((c) => ({ ...c, relatorio_atendimento_enabled: v }))} disabled={loading} />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
          ) : (
            <>
              <div className={cfg.relatorio_atendimento_enabled ? '' : 'opacity-50 pointer-events-none'}>
                <div className="max-w-xs space-y-2">
                  <Label className="text-xs flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Enviar todo dia às (horário de Brasília)</Label>
                  <Select value={String(cfg.relatorio_atendimento_hora)} onValueChange={(v) => setCfg((c) => ({ ...c, relatorio_atendimento_hora: Number(v) }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{horas.map((h) => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              {!cfg.relatorio_atendimento_enabled && <p className="text-xs text-amber-500">Desligado: o relatório diário de atendimento não será enviado.</p>}
              <div className="flex justify-end">
                <Button onClick={salvarRelatorioAtendimento} disabled={savingRel} className="gap-2">
                  {savingRel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar horário
                </Button>
              </div>

              {/* Destinatários */}
              <div className="border-t border-border/40 pt-4">
                <Label className="text-xs flex items-center gap-1.5 mb-3"><Users className="h-3.5 w-3.5" /> Quem recebe este relatório</Label>
                {loadingResp ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
                ) : (
                  <div className="space-y-2">
                    {resp.length === 0 && <p className="text-[11px] text-muted-foreground">Nenhum responsável cadastrado ainda. Adicione abaixo.</p>}
                    {resp.map((r) => (
                      <div key={r.id} className="flex items-center justify-between rounded-lg border border-border/40 bg-background/40 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{r.nome || 'Sem nome'}</p>
                          <p className="text-[11px] text-muted-foreground">{r.whatsapp}</p>
                        </div>
                        <Switch checked={!!r.recebe_atendimento} onCheckedChange={(v) => toggleRecebe(r.id, v)} />
                      </div>
                    ))}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center pt-1">
                      <Input placeholder="Nome" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} className="sm:max-w-[40%]" />
                      <Input placeholder="WhatsApp com DDD" value={novoWa} onChange={(e) => setNovoWa(e.target.value)} className="sm:max-w-[40%]" />
                      <Button variant="outline" onClick={addResp} disabled={addingResp} className="gap-1.5 shrink-0">
                        {addingResp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Adicionar
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Ligar/desligar aqui só controla este relatório — não remove o responsável da conta. Os mesmos responsáveis aparecem na aba <span className="font-medium text-foreground">Responsáveis</span>.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Relatório do José (campanhas — Fluxo A / apollo_cron_config) ── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 border border-orange-500/30">
                <Target className="h-5 w-5 text-orange-400" />
              </div>
              <div>
                <CardTitle className="text-base">Relatório do José (campanhas)</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Resumo diário do tráfego pago que o José envia no WhatsApp. Defina se envia, a que horas e para qual número.
                </CardDescription>
              </div>
            </div>
            {jose && (
              <Switch checked={!!jose.send_daily_report} onCheckedChange={(v) => setJose((j: any) => ({ ...j, send_daily_report: v }))} disabled={loadingJose} />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {loadingJose ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
          ) : !jose ? (
            <p className="text-xs text-muted-foreground">
              O relatório do José ainda não está configurado nesta conta. Ele é ativado quando você conecta a conta de anúncios e liga o José no painel dele — depois o controle de horário e destinatário aparece aqui.
            </p>
          ) : (
            <>
              <div className={jose.send_daily_report ? '' : 'opacity-50 pointer-events-none'}>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Enviar todo dia às</Label>
                    <div className="flex items-center gap-2">
                      <Select value={String(jose.run_hour ?? 8)} onValueChange={(v) => setJose((j: any) => ({ ...j, run_hour: Number(v) }))}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>{horas.map((h) => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}h</SelectItem>)}</SelectContent>
                      </Select>
                      <span className="text-muted-foreground text-sm">:</span>
                      <Select value={String(jose.run_minute ?? 0)} onValueChange={(v) => setJose((j: any) => ({ ...j, run_minute: Number(v) }))}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>{[0, 15, 30, 45].map((m) => <SelectItem key={m} value={String(m)}>{String(m).padStart(2, '0')}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Fuso: {jose.timezone || 'America/Sao_Paulo'}. Vale a partir do próximo ciclo.</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">WhatsApp que recebe</Label>
                    <Input placeholder="Número com DDD" value={jose.whatsapp_report_number || ''} onChange={(e) => setJose((j: any) => ({ ...j, whatsapp_report_number: e.target.value }))} />
                    <p className="text-[11px] text-muted-foreground">O relatório do José vai para este único número.</p>
                  </div>
                </div>
              </div>
              {!jose.send_daily_report && <p className="text-xs text-amber-500">Desligado: o relatório diário do José não será enviado.</p>}
              {jose.is_enabled === false && <p className="text-xs text-amber-500">Atenção: o José está pausado no painel dele — enquanto isso o relatório não sai, mesmo ligado aqui.</p>}
              <div className="flex justify-end">
                <Button onClick={salvarJose} disabled={savingJose} className="gap-2">
                  {savingJose ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
