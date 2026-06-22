import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { MessageSquare, Send, Loader2, Sparkles } from 'lucide-react';

// ── Bloco B — chat conversável do José na tela principal. Mesmo cérebro do WhatsApp
// (edge jose-chat -> joseBrain), lê os MESMOS dados dos cards. Auto-esconde (null) se
// o flag jose_chat estiver off (sonda via ping).
const db = supabase as any;
type Msg = { role: 'user' | 'assistant'; content: string };

const SUGESTOES = [
  'Como está meu custo por lead bom?',
  'De qual anúncio vêm os leads ruins?',
  'Qual anúncio eu deveria pausar?',
];

export function JoseChatPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await db.functions.invoke('jose-chat', { body: { ping: true } });
        setEnabled(data?.enabled === true);
      } catch { setEnabled(false); }
    })();
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || sending) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: q }]);
    setSending(true);
    try {
      const { data, error } = await db.functions.invoke('jose-chat', { body: { message: q, session_id: sessionId } });
      if (error) throw error;
      if (data?.session_id) setSessionId(data.session_id);
      setMessages((m) => [...m, { role: 'assistant', content: data?.text || 'Não consegui responder agora.' }]);
    } catch (e: any) {
      toast.error('Erro no chat do José: ' + (e?.message || e));
      setMessages((m) => [...m, { role: 'assistant', content: 'Tive um problema pra responder. Tenta de novo?' }]);
    } finally { setSending(false); }
  }, [sending, sessionId]);

  if (enabled !== true) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" /> Converse com o José</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
          {messages.length === 0 && (
            <div className="text-xs text-muted-foreground space-y-2">
              <p className="flex items-center gap-1"><Sparkles className="h-3 w-3" /> Pergunte em linguagem natural — ele lê os mesmos números dos cards.</p>
              <div className="flex flex-wrap gap-1">
                {SUGESTOES.map((s) => (
                  <Button key={s} size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => send(s)}>{s}</Button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs whitespace-pre-wrap ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{m.content}</div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-3 py-2 text-xs flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> pensando...</div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Pergunte ao José..." className="h-9 text-sm" disabled={sending} />
          <Button type="submit" size="sm" className="h-9 gap-1" disabled={sending || !input.trim()}><Send className="h-3.5 w-3.5" /></Button>
        </form>
      </CardContent>
    </Card>
  );
}
