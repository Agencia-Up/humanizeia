/**
 * BriefingSmartUpload.tsx
 * Componente inteligente de criação de briefing para o Salomão.
 *
 * Funcionalidades:
 *  1. Download do modelo de briefing (.txt)
 *  2. Upload de documento (TXT, DOCX, PDF) ou cola direto
 *  3. IA (Claude) extrai e estrutura o briefing automaticamente
 *  4. Chat inteligente para preencher campos faltantes
 *  5. Salva no Supabase (client_briefings) e retorna o ID para o pipeline
 */

import { useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Upload, Download, Sparkles, Send, CheckCircle2, AlertCircle,
  FileText, X, Loader2, MessageSquare, ClipboardPaste, ChevronDown, ChevronUp,
  RefreshCw,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExtractedBriefing {
  business_name: string | null;
  produto: string | null;
  target_audience: string | null;
  dor: string | null;
  desejo: string | null;
  diferencial: string | null;
  oferta: string | null;
  preco: string | null;
  garantia: string | null;
  canais: string | null;
  tom: string | null;
  objetivo: string | null;
  resultados: string | null;
  cta: string | null;
  site: string | null;
  redesSociais: string | null;
  paletaCores: string | null;
  identidadeVisual: string | null;
  objecoes: string | null;
  devesFazer: string | null;
  naoFazer: string | null;
}

const FIELD_LABELS: Record<keyof ExtractedBriefing, string> = {
  business_name: 'Nome do Negócio / Marca',
  produto: 'Produto ou Serviço',
  target_audience: 'Público-Alvo',
  dor: 'Dor Principal do Cliente',
  desejo: 'Maior Desejo do Cliente',
  diferencial: 'Diferencial Único',
  oferta: 'Oferta Principal',
  preco: 'Preço / Investimento',
  garantia: 'Garantia',
  canais: 'Canais de Aquisição',
  tom: 'Tom de Voz',
  objetivo: 'Objetivo Principal',
  resultados: 'Resultados / Provas Sociais',
  cta: 'CTA Principal',
  site: 'Site',
  redesSociais: 'Redes Sociais',
  paletaCores: 'Paleta de Cores',
  identidadeVisual: 'Identidade Visual',
  objecoes: 'Principais Objeções',
  devesFazer: 'O que o Agente Deve Fazer',
  naoFazer: 'O que NÃO Fazer',
};

const REQUIRED_FIELDS: (keyof ExtractedBriefing)[] = [
  'business_name', 'produto', 'target_audience', 'dor', 'diferencial', 'oferta', 'objetivo', 'tom',
];

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  onBriefingSaved: (briefingId: string, clientName: string) => void;
}

// ── Template text ─────────────────────────────────────────────────────────────

const TEMPLATE_TEXT = `═══════════════════════════════════════════════════════
  MODELO DE BRIEFING — LOGOS IA PLATFORM
  Preencha todos os campos e suba este arquivo no Salomão
═══════════════════════════════════════════════════════

1. NEGÓCIO & MARCA
   Nome do Negócio / Marca:
   Produto ou Serviço:
   Diferencial Único (por que é melhor?):
   Site:
   Redes Sociais:

2. IDENTIDADE VISUAL
   Paleta de Cores (hex ou nomes):
   Identidade Visual (estilo, referências):

3. CLIENTE IDEAL (ICP)
   Público-Alvo (idade, perfil, cargo):
   Dor Principal (problema que mais sofre):
   Maior Desejo (resultado que quer alcançar):
   Principais Objeções (por que não compra):

4. OFERTA & PREÇO
   Oferta Principal:
   Preço / Investimento:
   Garantia ou Bônus:

5. AQUISIÇÃO & COMUNICAÇÃO
   Canais de Aquisição (Meta, Google, orgânico...):
   Tom de Voz (direto, empático, técnico, etc.):
   Objetivo Principal (gerar lead, fechar venda, etc.):
   CTA Principal (link ou ação desejada):

6. AUTORIDADE & PROVAS
   Resultados obtidos / Números / Cases:

7. REGRAS DO AGENTE
   O que o agente DEVE fazer:
   O que o agente NÃO pode fazer:

═══════════════════════════════════════════════════════
  Salve este arquivo como .txt e suba no Salomão
═══════════════════════════════════════════════════════
`;

// ── Main Component ────────────────────────────────────────────────────────────

export function BriefingSmartUpload({ onBriefingSaved }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Phases: idle → reading → extracting → reviewing → saving → done
  const [phase, setPhase] = useState<'idle' | 'reading' | 'extracting' | 'reviewing' | 'saving' | 'done'>('idle');
  const [isDragOver, setIsDragOver] = useState(false);
  const [showPasteArea, setShowPasteArea] = useState(false);
  const [pastedText, setPastedText] = useState('');

  // Extracted data
  const [extracted, setExtracted] = useState<ExtractedBriefing | null>(null);
  const [showAllFields, setShowAllFields] = useState(false);

  // Chat for missing fields
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // Done
  const [savedId, setSavedId] = useState<string | null>(null);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const getMissingFields = (data: ExtractedBriefing) =>
    REQUIRED_FIELDS.filter(f => !data[f]?.trim());

  const getFilledCount = (data: ExtractedBriefing) =>
    (Object.keys(FIELD_LABELS) as (keyof ExtractedBriefing)[]).filter(f => data[f]?.trim()).length;

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_TEXT], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo-briefing-logosIA.txt';
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: '📥 Modelo baixado!', description: 'Preencha e suba o arquivo no Salomão.' });
  };

  // ── File reading ──────────────────────────────────────────────────────────

  const readFile = useCallback((file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'txt' || ext === 'md') {
      const reader = new FileReader();
      reader.onload = e => {
        const text = e.target?.result as string;
        if (text?.trim()) extractFromText(text);
        else toast({ title: 'Arquivo vazio', variant: 'destructive' });
      };
      reader.readAsText(file, 'UTF-8');
    } else if (ext === 'docx' || ext === 'doc' || ext === 'pdf') {
      setShowPasteArea(true);
      setPhase('idle');
      toast({
        title: `Arquivo ${ext.toUpperCase()} detectado`,
        description: 'Abra o documento, selecione tudo (Ctrl+A), copie (Ctrl+C) e cole na área abaixo.',
      });
    } else {
      toast({ title: 'Formato não suportado', description: 'Use .txt, .docx ou .pdf', variant: 'destructive' });
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) { setPhase('reading'); readFile(file); }
  }, [readFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setPhase('reading'); readFile(file); }
    e.target.value = '';
  };

  // ── AI Extraction ─────────────────────────────────────────────────────────

  const extractFromText = async (rawText: string) => {
    setPhase('extracting');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão expirada');

      const prompt = `Você é um especialista em briefing de marketing digital. Analise o texto abaixo e extraia as informações estruturadas.

RETORNE APENAS um JSON válido (sem markdown, sem explicações) com EXATAMENTE estas chaves:
{
  "business_name": "nome da empresa/marca ou null",
  "produto": "produto ou serviço ou null",
  "target_audience": "público-alvo ou null",
  "dor": "dor principal do cliente ou null",
  "desejo": "maior desejo do cliente ou null",
  "diferencial": "diferencial único ou null",
  "oferta": "oferta principal ou null",
  "preco": "preço ou null",
  "garantia": "garantia ou null",
  "canais": "canais de aquisição ou null",
  "tom": "tom de voz ou null",
  "objetivo": "objetivo principal ou null",
  "resultados": "resultados/provas sociais ou null",
  "cta": "call to action ou null",
  "site": "site ou null",
  "redesSociais": "redes sociais ou null",
  "paletaCores": "cores da marca ou null",
  "identidadeVisual": "estilo visual ou null",
  "objecoes": "principais objeções ou null",
  "devesFazer": "o que o agente deve fazer ou null",
  "naoFazer": "o que não fazer ou null"
}

TEXTO DO DOCUMENTO:
${rawText.slice(0, 8000)}`;

      const res = await supabase.functions.invoke('claude-chat', {
        body: {
          messages: [{ role: 'user', content: prompt }],
          context: 'assistant',
          config: { description: 'Extrator de briefing de marketing. Retorna apenas JSON válido.' },
        },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.error) throw new Error(res.error.message);
      const content: string = res.data?.choices?.[0]?.message?.content
        ?? res.data?.content
        ?? res.data?.message
        ?? '';

      // Parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Claude não retornou JSON válido');
      const parsed: ExtractedBriefing = JSON.parse(jsonMatch[0]);

      setExtracted(parsed);
      setPhase('reviewing');

      const missing = getMissingFields(parsed);
      if (missing.length > 0) {
        setChatMessages([{
          role: 'assistant',
          content: `Extraí ${getFilledCount(parsed)} campos do documento! ✅\n\nAinda faltam ${missing.length} campos importantes:\n${missing.map(f => `• ${FIELD_LABELS[f]}`).join('\n')}\n\nMe conte sobre eles em linguagem natural — pode descrever tudo junto, eu organizo.`,
        }]);
      } else {
        setChatMessages([{
          role: 'assistant',
          content: `Perfeito! Extraí todos os campos do documento com sucesso! 🎉\n\nRevisite os dados abaixo e clique em **Salvar Briefing** quando estiver tudo certo.`,
        }]);
      }
    } catch (err: any) {
      toast({ title: 'Erro na extração', description: err.message, variant: 'destructive' });
      setPhase('idle');
    }
  };

  // ── Chat for missing fields ───────────────────────────────────────────────

  const sendChatMessage = async () => {
    if (!chatInput.trim() || !extracted || chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput('');
    setChatLoading(true);

    const newMessages: ChatMessage[] = [...chatMessages, { role: 'user', content: userMsg }];
    setChatMessages(newMessages);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const missing = getMissingFields(extracted);

      const prompt = `Você é um assistente de briefing de marketing. O usuário está descrevendo informações do cliente.

BRIEFING ATUAL (campos preenchidos):
${JSON.stringify(extracted, null, 2)}

CAMPOS QUE AINDA FALTAM:
${missing.map(f => `- ${FIELD_LABELS[f]}`).join('\n')}

O usuário disse: "${userMsg}"

Faça DUAS coisas:
1. Retorne um JSON com APENAS os campos que você conseguiu extrair da fala do usuário (mesmas chaves do briefing)
2. Após o JSON, escreva uma mensagem amigável confirmando o que foi adicionado e o que ainda falta

FORMATO OBRIGATÓRIO:
FIELDS_JSON:
{"campo": "valor", ...}
END_JSON
MENSAGEM: sua mensagem aqui`;

      const res = await supabase.functions.invoke('claude-chat', {
        body: {
          messages: [{ role: 'user', content: prompt }],
          context: 'assistant',
          config: { description: 'Assistente de briefing de marketing.' },
        },
        headers: { Authorization: `Bearer ${session!.access_token}` },
      });

      const content: string = res.data?.choices?.[0]?.message?.content
        ?? res.data?.content
        ?? res.data?.message
        ?? '';

      // Parse fields from response
      const jsonMatch = content.match(/FIELDS_JSON:\s*(\{[\s\S]*?\})\s*END_JSON/);
      const msgMatch = content.match(/MENSAGEM:\s*([\s\S]+)$/);

      if (jsonMatch) {
        try {
          const newFields = JSON.parse(jsonMatch[1]);
          setExtracted(prev => prev ? { ...prev, ...newFields } : prev);
        } catch (_) { /* ignore parse errors */ }
      }

      const assistantMsg = (msgMatch?.[1]?.trim()
        ?? content.replace(/FIELDS_JSON:[\s\S]*?END_JSON/g, '').trim())
        || 'Entendido! Campos atualizados.';

      setChatMessages([...newMessages, { role: 'assistant', content: assistantMsg }]);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err: any) {
      setChatMessages([...newMessages, { role: 'assistant', content: 'Desculpe, tive um erro. Tente novamente.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  // ── Save briefing ─────────────────────────────────────────────────────────

  const saveBriefing = async () => {
    if (!extracted || !user) return;
    setPhase('saving');
    try {
      const { data, error } = await supabase
        .from('client_briefings' as any)
        .insert({
          user_id: user.id,
          business_name: extracted.business_name ?? 'Cliente sem nome',
          target_audience: extracted.target_audience ?? '',
          offering_details: [extracted.produto, extracted.oferta, extracted.preco, extracted.garantia].filter(Boolean).join(' | '),
          tone_of_voice: extracted.tom ?? '',
          goals: { objetivo: extracted.objetivo, cta: extracted.cta },
          custom_context: extracted,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);

      const savedData = data as any;
      setSavedId(savedData.id);
      setPhase('done');
      onBriefingSaved(savedData.id, extracted.business_name ?? 'Cliente');
      toast({ title: '✅ Briefing salvo!', description: `ID: ${savedData.id.slice(0, 8)}... Pronto para o pipeline!` });
    } catch (err: any) {
      toast({ title: 'Erro ao salvar', description: err.message, variant: 'destructive' });
      setPhase('reviewing');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  // DONE state
  if (phase === 'done' && savedId) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center space-y-2">
          <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto" />
          <p className="font-semibold text-sm text-emerald-400">Briefing Salvo com Sucesso!</p>
          <p className="text-[10px] font-mono text-muted-foreground break-all">{savedId}</p>
          <p className="text-xs text-muted-foreground">Pipeline atualizado automaticamente ↓</p>
        </div>
        <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => { setPhase('idle'); setExtracted(null); setChatMessages([]); setSavedId(null); setPastedText(''); setShowPasteArea(false); }}>
          <RefreshCw className="h-3.5 w-3.5" /> Novo Briefing
        </Button>
      </div>
    );
  }

  // REVIEWING state
  if ((phase === 'reviewing' || phase === 'saving') && extracted) {
    const missing = getMissingFields(extracted);
    const filled = getFilledCount(extracted);
    const total = Object.keys(FIELD_LABELS).length;
    const allFields = Object.keys(FIELD_LABELS) as (keyof ExtractedBriefing)[];
    const visibleFields = showAllFields ? allFields : allFields.filter(f => extracted[f] || REQUIRED_FIELDS.includes(f));

    return (
      <div className="space-y-3">
        {/* Progress */}
        <div className="rounded-xl border border-border/50 bg-card/40 p-3">
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-muted-foreground">Campos extraídos</span>
            <span className={`font-bold ${filled >= total * 0.8 ? 'text-emerald-400' : filled >= total * 0.5 ? 'text-amber-400' : 'text-red-400'}`}>
              {filled}/{total} campos
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(filled / total) * 100}%` }} />
          </div>
          {missing.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {missing.map(f => (
                <Badge key={f} variant="outline" className="text-[9px] text-amber-400 border-amber-500/30 bg-amber-500/10">
                  <AlertCircle className="h-2.5 w-2.5 mr-1" />{FIELD_LABELS[f]}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Extracted fields */}
        <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
          <div className="px-3 py-2 border-b border-border/40 flex items-center justify-between">
            <span className="text-xs font-semibold">Dados Extraídos</span>
            <button onClick={() => setShowAllFields(!showAllFields)} className="text-[10px] text-muted-foreground flex items-center gap-1">
              {showAllFields ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showAllFields ? 'Ver menos' : 'Ver todos'}
            </button>
          </div>
          <ScrollArea className="max-h-40">
            <div className="p-3 space-y-1.5">
              {visibleFields.map(field => (
                <div key={field} className="flex items-start gap-2">
                  {extracted[field] ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] text-muted-foreground">{FIELD_LABELS[field]}: </span>
                    <span className="text-[10px] text-foreground">{extracted[field] ?? '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Chat */}
        <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
          <div className="px-3 py-2 border-b border-border/40 flex items-center gap-2">
            <MessageSquare className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs font-semibold">Salomão — Assistente de Briefing</span>
          </div>
          <ScrollArea className="h-32">
            <div className="p-3 space-y-2">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] text-xs px-3 py-2 rounded-xl leading-relaxed whitespace-pre-line ${
                    msg.role === 'user'
                      ? 'bg-amber-500/20 text-amber-200 rounded-br-sm'
                      : 'bg-muted/50 text-foreground rounded-bl-sm'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted/50 px-3 py-2 rounded-xl rounded-bl-sm">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          </ScrollArea>
          <div className="p-2 border-t border-border/40 flex gap-2">
            <Textarea
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }}
              placeholder="Descreva informações faltantes em linguagem natural..."
              className="text-xs min-h-[40px] max-h-20 resize-none bg-background/50"
            />
            <Button size="sm" onClick={sendChatMessage} disabled={!chatInput.trim() || chatLoading} className="bg-amber-500 hover:bg-amber-600 text-black self-end">
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Save */}
        <Button
          onClick={saveBriefing}
          disabled={phase === 'saving'}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-2 font-semibold"
        >
          {phase === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {phase === 'saving' ? 'Salvando...' : `Salvar Briefing${missing.length > 0 ? ` (${missing.length} campos faltando)` : ''}`}
        </Button>
        <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={() => { setPhase('idle'); setExtracted(null); setChatMessages([]); }}>
          <X className="h-3.5 w-3.5 mr-1.5" />Recomeçar
        </Button>
      </div>
    );
  }

  // EXTRACTING state
  if (phase === 'extracting' || phase === 'reading') {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 text-center space-y-3">
        <Sparkles className="h-8 w-8 text-amber-400 mx-auto animate-pulse" />
        <p className="text-sm font-semibold text-amber-400">
          {phase === 'reading' ? 'Lendo arquivo...' : 'Salomão está analisando o documento...'}
        </p>
        <p className="text-xs text-muted-foreground">
          {phase === 'extracting' ? 'Claude está extraindo e estruturando as informações de briefing' : 'Aguarde um momento'}
        </p>
        <div className="flex justify-center gap-1 pt-1">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    );
  }

  // IDLE state
  return (
    <div className="space-y-3">
      {/* Download template */}
      <Button variant="outline" size="sm" className="w-full gap-2 border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/50" onClick={downloadTemplate}>
        <Download className="h-3.5 w-3.5" />
        Baixar Modelo de Briefing (.txt)
      </Button>

      {/* Drag-drop upload */}
      <div
        onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`rounded-xl border-2 border-dashed p-5 text-center cursor-pointer transition-all ${
          isDragOver
            ? 'border-amber-400 bg-amber-500/10'
            : 'border-border/40 hover:border-amber-500/40 hover:bg-amber-500/5'
        }`}
      >
        <Upload className={`h-7 w-7 mx-auto mb-2 ${isDragOver ? 'text-amber-400' : 'text-muted-foreground/50'}`} />
        <p className="text-xs font-semibold text-foreground/80">Arraste ou clique para subir</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">Suporta .txt · Para .docx/.pdf use a opção "Colar texto"</p>
        <input ref={fileInputRef} type="file" accept=".txt,.md,.docx,.doc,.pdf" className="hidden" onChange={handleFileChange} />
      </div>

      {/* Paste text */}
      <button
        onClick={() => setShowPasteArea(!showPasteArea)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border/40 text-xs text-muted-foreground hover:text-foreground hover:border-border/70 transition-colors"
      >
        <ClipboardPaste className="h-3.5 w-3.5" />
        <span>Colar texto do documento</span>
        {showPasteArea ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
      </button>

      {showPasteArea && (
        <div className="space-y-2">
          <Textarea
            value={pastedText}
            onChange={e => setPastedText(e.target.value)}
            placeholder="Cole aqui todo o conteúdo do documento, e-mail, apresentação ou qualquer texto com informações do cliente..."
            className="text-xs min-h-[100px] resize-none bg-background/50 border-border/60"
          />
          <Button
            size="sm"
            className="w-full bg-amber-500 hover:bg-amber-600 text-black gap-2 font-semibold"
            onClick={() => { if (pastedText.trim()) extractFromText(pastedText); else toast({ title: 'Cole algum texto primeiro', variant: 'destructive' }); }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Salomão — Extrair Briefing com IA
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2 py-0.5">
        <div className="flex-1 h-px bg-border/30" />
        <span className="text-[10px] text-muted-foreground">ou cole o UUID de um briefing salvo</span>
        <div className="flex-1 h-px bg-border/30" />
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          placeholder="UUID do briefing..."
          className="flex-1 text-xs px-3 py-2 rounded-lg border border-border/60 bg-background/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/40"
          onChange={e => {
            const val = e.target.value.trim();
            if (val.length >= 30) {
              onBriefingSaved(val, 'Cliente selecionado');
              setSavedId(val);
              setPhase('done');
            }
          }}
        />
        <FileText className="h-4 w-4 text-muted-foreground self-center" />
      </div>
    </div>
  );
}
