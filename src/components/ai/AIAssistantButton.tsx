import { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { motion, AnimatePresence } from 'framer-motion';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import { useMetaInsights } from '@/hooks/useMetaInsights';
import { useMetaConnection } from '@/hooks/useMetaConnection';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export function AIAssistantButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'assistant', content: 'Olá! Sou seu assistente de IA especializado em tráfego pago. Como posso ajudar com suas campanhas hoje?', timestamp: new Date() },
  ]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const { connectedAccount } = useMetaConnection();

  const { data: accountData } = useMetaInsights({
    accountId: connectedAccount?.account_id,
    datePreset: 'last_7d',
    fields: 'spend,impressions,clicks,ctr,actions,action_values',
    enabled: !!connectedAccount && isOpen,
  });

  const { sendMessage, isLoading } = useClaudeChat({
    context: 'assistant',
    config: { metricsData: accountData?.data?.[0] || accountData?.[0] || {} },
    onDelta: (delta) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.id.startsWith('streaming-')) {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: m.content + delta } : m);
        }
        return prev;
      });
    },
    onComplete: (fullResponse) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.id.startsWith('streaming-')) {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, id: Date.now().toString(), content: fullResponse } : m);
        }
        return prev;
      });
    },
    onError: (error) => {
      setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'assistant', content: `Erro: ${error}`, timestamp: new Date() }]);
    },
  });

  useEffect(() => { scrollRef.current && (scrollRef.current.scrollTop = scrollRef.current.scrollHeight); }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input, timestamp: new Date() };
    const streamMsg: Message = { id: `streaming-${Date.now()}`, role: 'assistant', content: '', timestamp: new Date() };
    setMessages(prev => [...prev, userMsg, streamMsg]);
    setInput('');
    const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));
    try { await sendMessage(history); } catch {}
  };

  return (
    <>
      <motion.div className="fixed bottom-6 right-6 z-50" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5, type: 'spring' }}>
        <Button onClick={() => setIsOpen(!isOpen)} className="h-14 w-14 rounded-full gradient-primary shadow-lg glow-primary" size="icon">
          {isOpen ? <X className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
        </Button>
      </motion.div>

      <AnimatePresence>
        {isOpen && (
          <motion.div initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-24 right-6 z-50 w-96 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center gap-3 border-b border-border gradient-primary p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20"><Sparkles className="h-5 w-5 text-white" /></div>
              <div><h3 className="font-semibold text-white">AI Assistant</h3><p className="text-xs text-white/80">Dados reais do Meta Ads</p></div>
            </div>
            <ScrollArea className="h-80 p-4" ref={scrollRef}>
              <div className="flex flex-col gap-4">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${m.role === 'user' ? 'gradient-primary text-white' : 'bg-muted'}`}>
                      <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div className="border-t border-border p-4">
              <div className="flex gap-2">
                <Input value={input} onChange={e => setInput(e.target.value)} placeholder="Pergunte sobre suas campanhas..."
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()} className="flex-1" disabled={isLoading} />
                <Button onClick={handleSend} size="icon" className="gradient-primary" disabled={!input.trim() || isLoading}><Send className="h-4 w-4" /></Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
