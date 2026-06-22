import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  MessageSquare, Send, Loader2, Sparkles, Paperclip, Mic, Square, X, FileText,
  Image as ImageIcon, Check, Target, DollarSign, MessageCircle, CheckCircle2,
  Gauge, BarChart3, Lightbulb,
} from 'lucide-react';

// ── Bloco B — chat conversável do José (estilo ChatGPT) na tela principal. Mesmo
// cérebro do WhatsApp (edge jose-chat -> joseBrain), lê os MESMOS dados dos cards.
// Reskin premium no padrão do mockup do dono: painel "Contexto analisado" + thread
// com avatar/horário + card de sugestão (Autorizar/Cancelar). A LÓGICA é a mesma.
const db = supabase as any;
type Proposal = { approval_id: string; resumo: string; risco: string; action_type: string };
type Msg = { role: 'user' | 'assistant'; content: string; proposal?: Proposal | null; decided?: 'aprovado' | 'rejeitado'; ts?: string };
type Attach = { kind: 'image' | 'audio' | 'document'; mime: string; base64: string; name: string };
type Contexto = { moeda: string; gasto: number; conversas: number; cpl: number | null; custo_por_lead_bom: number | null; leads_bom: number } | null;

const SUGESTOES = [
  'Qual anúncio eu deveria pausar?',
  'De qual anúncio vêm os leads ruins?',
  'Como está meu custo por lead bom?',
];
const QUICK = [
  { label: 'Analisar campanhas', icon: BarChart3, msg: 'Analise minhas campanhas ativas e me diga o que está indo bem e o que não está.' },
  { label: 'Gerar recomendação', icon: Lightbulb, msg: 'Me dê uma recomendação do que fazer agora pra melhorar os resultados.' },
  { label: 'Criar campanha', icon: Sparkles, msg: 'Quero criar uma campanha nova. Me ajuda a montar?' },
];

const ACAO_TITULO: Record<string, string> = {
  pause: 'Pausar campanha', activate: 'Reativar campanha',
  increase_budget: 'Aumentar a verba', decrease_budget: 'Reduzir a verba',
};

function nowHHMM() { try { return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } }
function money(moeda: string, v: number | null | undefined) {
  return v == null ? '—' : `${moeda} ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function int(v: number | null | undefined) { return Number(v || 0).toLocaleString('pt-BR'); }

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// Avatar do José (alvo num círculo gradiente indigo→dourado).
function JoseAvatar({ big = false }: { big?: boolean }) {
  return (
    <div className={`flex ${big ? 'h-9 w-9' : 'h-8 w-8'} shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-white ring-1 ring-inset ring-amber-300/40 shadow-sm shadow-amber-500/25`}>
      <Target className={big ? 'h-5 w-5' : 'h-4 w-4'} />
    </div>
  );
}

// Tijolo do "Contexto analisado".
function CtxCard({ icon: Icon, label, value, tile, wrap }: { icon: any; label: string; value: string; tile: string; wrap: string }) {
  return (
    <div className={`rounded-xl border p-3 shadow-sm shadow-black/20 ${wrap}`}>
      <div className="flex items-center gap-2.5">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${tile}`}><Icon className="h-4 w-4" /></div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-sm font-bold tabular-nums leading-tight truncate text-foreground">{value}</div>
        </div>
      </div>
    </div>
  );
}

export function JoseChatPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pending, setPending] = useState<Attach[]>([]);
  const [recording, setRecording] = useState(false);
  const [contexto, setContexto] = useState<Contexto>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await db.functions.invoke('jose-chat', { body: { ping: true } });
        setEnabled(data?.enabled === true);
      } catch { setEnabled(false); }
    })();
  }, []);

  // Contexto analisado (dados de hoje) — best-effort; se falhar, o painel some.
  useEffect(() => {
    (async () => {
      try {
        const { data } = await db.functions.invoke('jose-dashboard', { body: { date_preset: 'today' } });
        const c = data?.cards;
        if (c) setContexto({ moeda: c.moeda, gasto: c.gasto, conversas: c.conversas, cpl: c.cpl, custo_por_lead_bom: c.custo_por_lead_bom, leads_bom: c.leads_bom });
      } catch { /* silencioso */ }
    })();
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);

  const onPickFile = useCallback(async (e: any) => {
    const file: File | undefined = e?.target?.files?.[0];
    if (e?.target) e.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast.error('Arquivo muito grande (máximo 8 MB).'); return; }
    const kind: Attach['kind'] = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'document';
    try {
      const base64 = await blobToBase64(file);
      setPending((p) => [...p, { kind, mime: file.type || (kind === 'document' ? 'application/pdf' : 'application/octet-stream'), base64, name: file.name }]);
    } catch { toast.error('Não consegui ler o arquivo.'); }
  }, []);

  const startRec = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunksRef.current.push(ev.data); };
      mr.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          const base64 = await blobToBase64(blob);
          setPending((p) => [...p, { kind: 'audio', mime: 'audio/webm', base64, name: 'gravação de voz' }]);
        } catch { /* ignora */ }
        stream.getTracks().forEach((t) => t.stop());
      };
      mr.start();
      mrRef.current = mr;
      setRecording(true);
    } catch { toast.error('Não consegui acessar o microfone.'); }
  }, []);

  const stopRec = useCallback(() => {
    try { mrRef.current?.stop(); } catch { /* */ }
    setRecording(false);
  }, []);

  const send = useCallback(async (textOverride?: string) => {
    const q = (textOverride ?? input).trim();
    const atts = pending;
    if ((!q && atts.length === 0) || sending) return;
    setInput('');
    setPending([]);
    const label = q || `(${atts.map((a) => a.name).join(', ')})`;
    setMessages((m) => [...m, { role: 'user', content: label, ts: nowHHMM() }]);
    setSending(true);
    try {
      const { data, error } = await db.functions.invoke('jose-chat', {
        body: { message: q, session_id: sessionId, attachments: atts.map(({ kind, mime, base64, name }) => ({ kind, mime, base64, name })) },
      });
      if (error) throw error;
      if (data?.session_id) setSessionId(data.session_id);
      setMessages((m) => [...m, { role: 'assistant', content: data?.text || 'Não consegui responder agora.', proposal: data?.proposal || null, ts: nowHHMM() }]);
    } catch (e: any) {
      toast.error('Erro no chat do José: ' + (e?.message || e));
      setMessages((m) => [...m, { role: 'assistant', content: 'Tive um problema pra responder. Tenta de novo?', ts: nowHHMM() }]);
    } finally { setSending(false); }
  }, [input, pending, sending, sessionId]);

  // Fecha o gate de aprovação (botões da proposta) -> jose-approval-handler executa na Meta.
  const decide = useCallback(async (idx: number, approvalId: string, decision: 'aprovado' | 'rejeitado') => {
    setMessages((m) => m.map((msg, i) => i === idx ? { ...msg, decided: decision } : msg));
    try {
      const { data, error } = await db.functions.invoke('jose-approval-handler', { body: { approval_id: approvalId, decision } });
      if (error) throw error;
      if (decision === 'aprovado') {
        toast.success(data?.ok ? 'Autorizado — o José executou a ação.' : (data?.error || 'Autorizado, mas não consegui executar agora.'));
      } else {
        toast('Proposta cancelada — nada foi executado.');
      }
    } catch (e: any) {
      setMessages((m) => m.map((msg, i) => i === idx ? { ...msg, decided: undefined } : msg));
      toast.error('Não consegui registrar sua resposta: ' + (e?.message || e));
    }
  }, []);

  if (enabled !== true) return null;

  return (
    <Card className="border-primary/30 shadow-lg shadow-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" /> Converse com o José</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
          {/* ── Contexto analisado ───────────────────────────────────────── */}
          <aside className="hidden lg:flex flex-col gap-2.5">
            <div className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5"><Gauge className="h-3.5 w-3.5" /> Contexto analisado</div>
            {contexto ? (
              <>
                <CtxCard icon={DollarSign} label="Investido" value={money(contexto.moeda, contexto.gasto)} tile="bg-blue-500/20 text-blue-400 ring-blue-400/30" wrap="border-blue-500/30 bg-blue-500/[0.07]" />
                <CtxCard icon={MessageCircle} label="Conversas" value={int(contexto.conversas)} tile="bg-cyan-500/20 text-cyan-300 ring-cyan-400/30" wrap="border-cyan-500/30 bg-cyan-500/[0.07]" />
                <CtxCard icon={Target} label="Custo por lead" value={money(contexto.moeda, contexto.cpl)} tile="bg-violet-500/20 text-violet-300 ring-violet-400/30" wrap="border-violet-500/30 bg-violet-500/[0.07]" />
                <CtxCard icon={CheckCircle2} label="Lead bom" value={contexto.leads_bom > 0 ? money(contexto.moeda, contexto.custo_por_lead_bom) : '—'} tile="bg-emerald-500/20 text-emerald-300 ring-emerald-400/30" wrap="border-emerald-500/30 bg-emerald-500/[0.07]" />
                <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-0.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Dados de hoje · atualizado agora</div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-border/60 p-3 text-[11px] text-muted-foreground">O José lê os mesmos números dos cards da Cabine pra responder.</div>
            )}
          </aside>

          {/* ── Chat ─────────────────────────────────────────────────────── */}
          <div className="flex flex-col rounded-xl border border-primary/20 bg-gradient-to-b from-primary/[0.04] to-transparent overflow-hidden">
            {/* Cabeçalho do José */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/50">
              <JoseAvatar big />
              <div>
                <div className="text-sm font-bold flex items-center gap-1.5">José <Badge variant="secondary" className="text-[9px] h-4 px-1.5">IA</Badge></div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Gestor de Tráfego IA</div>
              </div>
            </div>

            {/* Thread */}
            <div className="px-4 py-4 space-y-4 max-h-[420px] overflow-y-auto">
              {messages.length === 0 && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2.5">
                    <JoseAvatar />
                    <div className="rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-xs max-w-[85%]">
                      Oi! Sou o José, seu gestor de tráfego. Me pergunte sobre seus anúncios, custos e leads — ou peça pra eu analisar e sugerir uma ação.
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pl-10">
                    {SUGESTOES.map((s) => (
                      <Button key={s} size="sm" variant="outline" className="h-7 text-[11px] rounded-full border-primary/30 hover:bg-primary/10 hover:text-primary" onClick={() => send(s)}>{s}</Button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className="space-y-2">
                  <div className={`flex items-end gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    {m.role === 'assistant' && <JoseAvatar />}
                    <div className={`max-w-[85%] ${m.role === 'user' ? 'items-end' : ''}`}>
                      <div className={`rounded-2xl px-3.5 py-2.5 text-xs whitespace-pre-wrap ${m.role === 'user' ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted rounded-tl-sm'}`}>{m.content}</div>
                      {m.ts && <div className={`text-[10px] text-muted-foreground mt-1 ${m.role === 'user' ? 'text-right' : 'pl-1'}`}>{m.ts}{m.role === 'user' && ' ✓✓'}</div>}
                    </div>
                  </div>

                  {/* Card de SUGESTÃO (proposta de ação) */}
                  {m.role === 'assistant' && m.proposal && (
                    <div className="ml-10">
                      <div className="rounded-xl border border-amber-500/50 bg-gradient-to-br from-amber-500/10 to-transparent p-3.5 shadow-sm shadow-black/20 max-w-[92%]">
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400 ring-1 ring-inset ring-amber-400/20"><Lightbulb className="h-4 w-4" /></div>
                          <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">Sugestão do José</span>
                          <Badge variant="outline" className="ml-auto text-[9px] h-4 px-1.5 border-amber-500/40 text-amber-600 dark:text-amber-400">risco {m.proposal.risco}</Badge>
                        </div>
                        <p className="text-sm font-semibold">{ACAO_TITULO[m.proposal.action_type] || 'Ação sugerida'}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{m.proposal.resumo}</p>
                        {m.decided ? (
                          <p className={`text-[11px] font-medium mt-2.5 ${m.decided === 'aprovado' ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                            {m.decided === 'aprovado' ? '✅ Autorizado — ação executada.' : '❌ Cancelado — nada foi executado.'}
                          </p>
                        ) : (
                          <div className="flex gap-2 mt-3">
                            <Button size="sm" variant="outline" className="h-8 text-[11px] gap-1" onClick={() => decide(i, m.proposal!.approval_id, 'rejeitado')}>
                              <X className="h-3.5 w-3.5" /> Cancelar
                            </Button>
                            <Button size="sm" className="h-8 text-[11px] gap-1 bg-amber-600 hover:bg-amber-700 text-white" onClick={() => decide(i, m.proposal!.approval_id, 'aprovado')}>
                              <Check className="h-3.5 w-3.5" /> Autorizar
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {sending && (
                <div className="flex items-end gap-2.5">
                  <JoseAvatar />
                  <div className="bg-muted rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-xs flex items-center gap-1.5 text-muted-foreground">
                    Analisando<span className="inline-flex gap-0.5"><span className="animate-bounce">.</span><span className="animate-bounce [animation-delay:120ms]">.</span><span className="animate-bounce [animation-delay:240ms]">.</span></span>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            {/* Chips de ação rápida */}
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {QUICK.map((q) => (
                <Button key={q.label} size="sm" variant="outline" className="h-7 text-[11px] gap-1.5 rounded-full border-primary/40 text-primary hover:bg-primary/10 hover:text-primary" disabled={sending} onClick={() => send(q.msg)}>
                  <q.icon className="h-3 w-3" /> {q.label}
                </Button>
              ))}
            </div>

            {/* Anexos pendentes */}
            {pending.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-4 pb-2">
                {pending.map((a, i) => (
                  <span key={i} className="inline-flex items-center gap-1 bg-muted rounded-md px-2 py-1 text-[11px]">
                    {a.kind === 'image' ? <ImageIcon className="h-3 w-3" /> : a.kind === 'audio' ? <Mic className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                    <span className="max-w-[140px] truncate">{a.name}</span>
                    <button type="button" className="opacity-60 hover:opacity-100" onClick={() => setPending((p) => p.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            )}

            {/* Barra de envio */}
            <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-1.5 px-3 py-3 border-t border-border/50">
              <input ref={fileRef} type="file" accept="image/*,audio/*,application/pdf" className="hidden" onChange={onPickFile} />
              <Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0" disabled={sending} onClick={() => fileRef.current?.click()} title="Anexar imagem, áudio ou PDF">
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon" variant={recording ? 'destructive' : 'ghost'} className="h-9 w-9 shrink-0" disabled={sending} onClick={recording ? stopRec : startRec} title={recording ? 'Parar gravação' : 'Gravar voz'}>
                {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
              <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={recording ? 'Gravando voz... clique no quadrado p/ parar' : 'Pergunte ao José ou envie um anexo...'} className="h-9 text-sm rounded-full" disabled={sending || recording} />
              <Button type="submit" size="sm" className="h-9 gap-1.5 shrink-0 rounded-full px-4" disabled={sending || (!input.trim() && pending.length === 0)}><Send className="h-3.5 w-3.5" /> Enviar</Button>
            </form>
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground text-center mt-3">O José pode errar. Sempre revise antes de aplicar mudanças.</p>
      </CardContent>
    </Card>
  );
}
