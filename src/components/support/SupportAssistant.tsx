/**
 * Assistente de Suporte da Logos IA — botão flutuante + painel.
 *
 * POSICIONAMENTO (decidido a partir do mapa de colisão real, não do chute):
 *  - z-40, nunca z-50: Dialog e Sheet do shadcn são todos z-50 neste projeto.
 *    Em z-50 o botão brigaria com QUALQUER modal aberto.
 *  - bottom-right: é o padrão que o público reconhece como "ajuda". Os 2
 *    toasters do projeto (shadcn z-[100] + sonner) passam por esse canto, mas
 *    são transitórios (segundos) e ficam ACIMA — cobrem por um instante, não
 *    disputam o clique de forma permanente.
 *  - SOME no mobile em /pedro, /marcos, /conversas e /whatsapp/inbox: nessas 4
 *    telas a caixa de mensagem ocupa o rodapé inteiro no celular (a lista some
 *    e o chat vira full-width). Um botão fixo ali cobriria o campo de responder
 *    o lead — que é o trabalho do vendedor. No desktop essas telas têm folga,
 *    então ele continua.
 *  - Nada de safe-area por enquanto: o index.html NÃO tem `viewport-fit=cover`,
 *    então env(safe-area-inset-bottom) resolveria pra 0 hoje. Mexer no
 *    index.html já derrubou o build deste projeto antes; fica pra Fase 3, junto
 *    com o teste em aparelho com notch.
 *
 * ⚠️ Existe um `src/components/ai/AIAssistantButton.tsx` MORTO no repo (não é
 * importado em lugar nenhum) que ocupa exatamente bottom-6 right-6 z-50. Se
 * alguém reativá-lo, os dois colidem. Registrado pro dono decidir.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  LifeBuoy, Send, Loader2, X, PlayCircle, ThumbsUp, ThumbsDown, Plus, Sparkles,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { descricaoErro } from '@/lib/erroAmigavel';

/** Rotas onde, no celular, o rodapé pertence à caixa de mensagem do lead. */
const ROTAS_CHAT = ['/pedro', '/marcos', '/conversas', '/whatsapp/inbox'];

const SUGESTOES = [
  'Como conectar meu WhatsApp?',
  'Como conectar o Meta Ads?',
  'Como cadastrar um vendedor?',
  'Como configurar o Pedro?',
  'Como ver meus leads?',
  'Como usar o Painel Geral?',
];

interface VideoRec { id: string; titulo: string; url: string; thumb?: string | null; plataforma?: string | null }
interface Msg {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  videos?: VideoRec[];
  semBase?: boolean;
  rating?: 'helpful' | 'not_helpful' | null;
}

export default function SupportAssistant() {
  const { user } = useAuth();
  const location = useLocation();
  const [aberto, setAberto] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);

  const naRotaDeChat = ROTAS_CHAT.includes(location.pathname);

  useEffect(() => {
    if (aberto) fimRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, aberto]);

  /** Retoma a última conversa — o dono pediu "continuar a última sessão". */
  const carregarUltima = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data: sess } = await supabase
        .from('support_chat_sessions')
        .select('id')
        .eq('status', 'open')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!sess?.id) return;
      const { data: hist } = await supabase
        .from('support_chat_messages')
        .select('id, role, content, sources')
        .eq('session_id', sess.id)
        .order('created_at', { ascending: true })
        .limit(40);
      if (!hist?.length) return;
      setSessionId(sess.id);
      setMsgs(hist
        .filter((m: any) => m.role !== 'system')
        .map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          videos: Array.isArray(m.sources)
            ? m.sources.filter((s: any) => s?.tipo === 'video')
                .map((s: any) => ({ id: s.id, titulo: s.titulo, url: s.url }))
            : [],
        })));
    } catch { /* histórico é conforto, não pode travar o chat */ }
  }, [user?.id]);

  useEffect(() => { if (aberto && !msgs.length) carregarUltima(); }, [aberto, msgs.length, carregarUltima]);

  const enviar = async (pergunta?: string) => {
    const q = (pergunta ?? texto).trim();
    if (!q || enviando) return;
    setTexto('');
    setMsgs(prev => [...prev, { role: 'user', content: q }]);
    setEnviando(true);
    try {
      const { data, error } = await supabase.functions.invoke('support-ai-chat', {
        body: {
          message: q,
          session_id: sessionId,
          current_path: location.pathname,
          current_page_title: document.title,
        },
      });
      if (error) throw error;
      if (data?.error && !data?.reply) throw new Error(data.error);
      if (data?.session_id) setSessionId(data.session_id);
      setMsgs(prev => [...prev, {
        id: data?.message_id,
        role: 'assistant',
        content: data?.reply ?? '',
        videos: data?.videos ?? [],
        semBase: !!data?.sem_base,
        rating: null,
      }]);
    } catch (e: any) {
      setMsgs(prev => [...prev, {
        role: 'assistant',
        content: descricaoErro(e) || 'Não consegui responder agora. Tente de novo em instantes.',
      }]);
    } finally {
      setEnviando(false);
    }
  };

  const avaliar = async (idx: number, rating: 'helpful' | 'not_helpful') => {
    const m = msgs[idx];
    if (!m?.id || !user?.id) return;
    setMsgs(prev => prev.map((x, i) => (i === idx ? { ...x, rating } : x)));
    try {
      await supabase.from('support_ai_feedback').upsert(
        { message_id: m.id, user_id: user.id, rating },
        { onConflict: 'message_id,user_id' },
      );
    } catch { /* avaliação não pode quebrar a conversa */ }
  };

  const novaConversa = () => { setMsgs([]); setSessionId(null); setTexto(''); };

  // PORTAL pra document.body: garante que o `fixed` do botão seja SEMPRE em
  // relação à TELA, nunca a um ancestral. Sintoma que motivou (dono, 17/07, no
  // CRM do Pedro/Marcos): o botão "Ajuda" ficava no FIM de todo o conteúdo (tinha
  // que rolar todos os leads pra alcançar) em vez de flutuar preso no canto.
  // Isso é o clássico "position:fixed neutralizado por um ancestral com transform/
  // filter/contain" — quando um pai tem qualquer um desses, o fixed passa a se
  // ancorar NELE, não na viewport, e vira efetivamente absolute (fica no rodapé
  // do conteúdo alto). Portalar pro body tira o nó de dentro de qualquer subárvore
  // transformada, então o fixed volta a valer contra a tela. É a correção robusta
  // pra a classe inteira do problema (não depende de achar QUAL ancestral).
  return createPortal(
    <>
      {/* Botão flutuante */}
      <button
        onClick={() => setAberto(true)}
        aria-label="Abrir suporte da Logos IA"
        className={`fixed bottom-5 right-5 z-40 items-center gap-2 rounded-full border border-primary/30
                    bg-primary px-4 py-3 text-primary-foreground shadow-lg transition
                    hover:scale-105 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2
                    focus-visible:ring-ring active:scale-95
                    ${naRotaDeChat ? 'hidden md:flex' : 'flex'}
                    ${aberto ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      >
        <LifeBuoy className="h-5 w-5" />
        <span className="hidden text-sm font-medium sm:inline">Ajuda</span>
      </button>

      <Sheet open={aberto} onOpenChange={setAberto}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
                <LifeBuoy className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight">Suporte Logos IA</p>
                <p className="text-[11px] text-muted-foreground">Tire dúvidas sobre a plataforma</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {msgs.length > 0 && (
                <Button variant="ghost" size="sm" onClick={novaConversa} className="h-8 gap-1 text-xs">
                  <Plus className="h-3.5 w-3.5" /> Nova
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={() => setAberto(false)} className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Conversa */}
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {msgs.length === 0 && (
              <div className="space-y-4">
                <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    Oi! Sou o suporte da Logos.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pergunte com suas palavras como fazer alguma coisa na plataforma. Se tiver vídeo, eu mando o link.
                  </p>
                </div>
                <div>
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Dúvidas comuns
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {SUGESTOES.map(s => (
                      <button
                        key={s}
                        onClick={() => enviar(s)}
                        className="rounded-lg border border-border/60 px-3 py-2 text-left text-xs transition hover:border-primary/40 hover:bg-muted/50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {msgs.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={`max-w-[88%] space-y-2 rounded-2xl px-3 py-2 text-xs leading-relaxed
                  ${m.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border/60 bg-muted/40'}`}>
                  <p className="whitespace-pre-line">{m.content}</p>

                  {/* Vídeo só aparece se veio do banco — a IA não inventa link. */}
                  {m.role === 'assistant' && !!m.videos?.length && (
                    <div className="space-y-1.5 pt-1">
                      {m.videos.map(v => (
                        <a
                          key={v.id}
                          href={v.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 rounded-lg border border-border/60 bg-background px-2 py-1.5 transition hover:border-primary/40"
                        >
                          <PlayCircle className="h-4 w-4 shrink-0 text-primary" />
                          <span className="truncate text-[11px] font-medium">{v.titulo}</span>
                        </a>
                      ))}
                    </div>
                  )}

                  {m.role === 'assistant' && m.id && (
                    <div className="flex items-center gap-1 pt-1">
                      <span className="mr-1 text-[10px] text-muted-foreground">Isso ajudou?</span>
                      <button
                        onClick={() => avaliar(i, 'helpful')}
                        aria-label="Ajudou"
                        className={`rounded p-1 transition hover:bg-background ${m.rating === 'helpful' ? 'text-emerald-400' : 'text-muted-foreground'}`}
                      >
                        <ThumbsUp className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => avaliar(i, 'not_helpful')}
                        aria-label="Não ajudou"
                        className={`rounded p-1 transition hover:bg-background ${m.rating === 'not_helpful' ? 'text-red-400' : 'text-muted-foreground'}`}
                      >
                        <ThumbsDown className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {enviando && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-muted/40 px-3 py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Procurando na base…</span>
                </div>
              </div>
            )}
            <div ref={fimRef} />
          </div>

          {/* Campo */}
          <div className="border-t border-border/60 p-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={texto}
                onChange={e => setTexto(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
                }}
                placeholder="Escreva sua dúvida…"
                rows={1}
                maxLength={1000}
                className="max-h-28 min-h-[38px] resize-none text-xs"
              />
              <Button size="icon" onClick={() => enviar()} disabled={!texto.trim() || enviando} className="h-9 w-9 shrink-0">
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
              Só respondo sobre a Logos IA. Para cobrança, veja Meu Plano.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>,
    document.body,
  );
}
