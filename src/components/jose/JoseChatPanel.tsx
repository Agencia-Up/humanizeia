import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { MessageSquare, Send, Loader2, Sparkles, Paperclip, Mic, Square, X, FileText, Image as ImageIcon } from 'lucide-react';

// ── Bloco B — chat conversável do José (estilo ChatGPT) na tela principal. Mesmo
// cérebro do WhatsApp (edge jose-chat -> joseBrain), lê os MESMOS dados dos cards.
// Aceita imagem (analisa), áudio (transcreve) e documento/PDF (lê). Auto-esconde se off.
const db = supabase as any;
type Msg = { role: 'user' | 'assistant'; content: string };
type Attach = { kind: 'image' | 'audio' | 'document'; mime: string; base64: string; name: string };

const SUGESTOES = [
  'Como está meu custo por lead bom?',
  'De qual anúncio vêm os leads ruins?',
  'Qual anúncio eu deveria pausar?',
];

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export function JoseChatPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pending, setPending] = useState<Attach[]>([]);
  const [recording, setRecording] = useState(false);
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
    setMessages((m) => [...m, { role: 'user', content: label }]);
    setSending(true);
    try {
      const { data, error } = await db.functions.invoke('jose-chat', {
        body: { message: q, session_id: sessionId, attachments: atts.map(({ kind, mime, base64, name }) => ({ kind, mime, base64, name })) },
      });
      if (error) throw error;
      if (data?.session_id) setSessionId(data.session_id);
      setMessages((m) => [...m, { role: 'assistant', content: data?.text || 'Não consegui responder agora.' }]);
    } catch (e: any) {
      toast.error('Erro no chat do José: ' + (e?.message || e));
      setMessages((m) => [...m, { role: 'assistant', content: 'Tive um problema pra responder. Tenta de novo?' }]);
    } finally { setSending(false); }
  }, [input, pending, sending, sessionId]);

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
              <p className="flex items-center gap-1"><Sparkles className="h-3 w-3" /> Pergunte em linguagem natural, ou envie uma <b>imagem</b>, um <b>áudio</b> ou um <b>PDF</b> — ele lê os mesmos números dos cards.</p>
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

        {pending.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pending.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1 bg-muted rounded-md px-2 py-1 text-[11px]">
                {a.kind === 'image' ? <ImageIcon className="h-3 w-3" /> : a.kind === 'audio' ? <Mic className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                <span className="max-w-[140px] truncate">{a.name}</span>
                <button type="button" className="opacity-60 hover:opacity-100" onClick={() => setPending((p) => p.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-1.5">
          <input ref={fileRef} type="file" accept="image/*,audio/*,application/pdf" className="hidden" onChange={onPickFile} />
          <Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0" disabled={sending} onClick={() => fileRef.current?.click()} title="Anexar imagem, áudio ou PDF">
            <Paperclip className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant={recording ? 'destructive' : 'ghost'} className="h-9 w-9 shrink-0" disabled={sending} onClick={recording ? stopRec : startRec} title={recording ? 'Parar gravação' : 'Gravar voz'}>
            {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={recording ? 'Gravando voz... clique no quadrado p/ parar' : 'Pergunte ao José ou envie um anexo...'} className="h-9 text-sm" disabled={sending || recording} />
          <Button type="submit" size="sm" className="h-9 gap-1 shrink-0" disabled={sending || (!input.trim() && pending.length === 0)}><Send className="h-3.5 w-3.5" /></Button>
        </form>
      </CardContent>
    </Card>
  );
}
