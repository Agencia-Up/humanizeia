import { useState, useRef, useEffect } from 'react';
import { OrchestrationPanel } from '@/components/salomao/OrchestrationPanel';
import { BriefingSmartUpload } from '@/components/salomao/BriefingSmartUpload';
import { AgentKnowledgeBase } from '@/features/orchestrator/components/AgentKnowledgeBase';
import { FunnelFlowchart } from '@/components/daniel/FunnelFlowchart';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Sparkles, Radar, PenTool, Palette, Send,
  Layers, Megaphone, Bot, Brain, Lock, CheckCircle, Users,
  FileCode2, Zap, Copy, Check, Loader2, ChevronRight,
  ShoppingBag, Target, MessageSquare, Shield, TrendingUp,
  Globe, Share2, BrainCircuit, Bot as BotIcon, X, ArrowRight,
} from 'lucide-react';
import { useAgentTasks } from '@/contexts/AgentTasksContext';
import { useAgentChat } from '@/contexts/AgentChatContext';

/* ── Agent definitions ──────────────────────────────────────────────── */
const AGENTS = [
  { id: 'salomao', name: 'SALOMÃO', role: 'Orquestrador', icon: Sparkles, description: 'Coordena todos os agentes. Recebe o briefing do cliente e distribui tarefas.', status: 'active', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20', url: '/salomao' },
  { id: 'jose', name: 'JOSÉ', role: 'Tráfego Pago', icon: Radar, description: 'Gerencia Meta Ads, Google Ads e TikTok com autonomia total. Analisa, otimiza, pausa e escala campanhas.', status: 'coming', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', url: null },
  { id: 'paulo', name: 'PAULO', role: 'Copywriter', icon: PenTool, description: 'Escreve headlines, body copy, CTAs, scripts de vídeo e sequências de email que convertem.', status: 'active', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', url: '/copywriter' },
  { id: 'maria', name: 'MARIA', role: 'Designer', icon: Palette, description: 'Cria imagens, banners e criativos com IA. Remove fundo, redimensiona e gera variações.', status: 'active', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20', url: '/creative-studio' },
  { id: 'daniel', name: 'DANIEL', role: 'Estrategista', icon: Brain, description: 'Analisa mercado, concorrentes e posicionamento. Define personas, ângulos e plano de 90 dias.', status: 'active', color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20', url: '/daniel' },
  { id: 'davi', name: 'DAVI', role: 'Social Media', icon: Send, description: 'Cria calendário editorial, escreve legendas e publica automaticamente no melhor horário.', status: 'active', color: 'text-pink-400', bg: 'bg-pink-500/10 border-pink-500/20', url: '/davi' },
  { id: 'joao', name: 'JOÃO', role: 'Email Marketing', icon: Megaphone, description: 'Cria sequências de nutrição, segmenta listas e envia campanhas no timing certo.', status: 'active', color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20', url: '/joao' },
  { id: 'pedro', name: 'PEDRO', role: 'SDR & Atendimento', icon: Bot, description: 'Qualifica leads, agenda reuniões e responde clientes 24/7 via WhatsApp com inteligência humana.', status: 'active', color: 'text-teal-400', bg: 'bg-teal-500/10 border-teal-500/20', url: '/whatsapp/ai-agent' },
];

/* ── Dynamic Briefing Structure ─────────────────────────────────────────── */
interface BriefingField {
  label: string;
  hint: string;
  key: string;
}

interface BriefingSection {
  title: string;
  fields: BriefingField[];
}

function parseBriefingTemplate(content: string): BriefingSection[] {
  const sections: BriefingSection[] = [];
  const lines = content.split('\n');
  let currentSection: BriefingSection | null = null;

  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Identify Section (## Title)
    if (trimmedLine.startsWith('##')) {
      const title = trimmedLine.replace(/^##\s*\d*\.?\s*/, '').trim();
      currentSection = { title, fields: [] };
      sections.push(currentSection);
      continue;
    }

    // Identify Field (* **Label:** Hint)
    if (trimmedLine.startsWith('*') && currentSection) {
      const match = trimmedLine.match(/^\*\s*\*\*(.*?):\*\*(.*)$/);
      if (match) {
        const label = match[1].trim();
        const hint = match[2].trim();
        const key = label.toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^\w\s-]/g, '')
          .trim()
          .replace(/[-\s]+/g, '_');
        
        currentSection.fields.push({ label, hint, key });
      }
    }
  }
  return sections;
}

function buildBriefingText(sections: BriefingSection[], data: Record<string, string>) {
  let text = '';
  for (const section of sections) {
    text += `\n${section.title.toUpperCase()}:\n`;
    for (const field of section.fields) {
      text += `${field.label}: ${data[field.key] || 'Não informado'}\n`;
    }
  }
  return text.trim();
}

/* ── Small helpers ───────────────────────────────────────────────────── */
function SectionCard({ num, icon: Icon, title, children }: { num: number; icon: React.ComponentType<{className?: string}>; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border/40 bg-card/60">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold shrink-0">{num}</div>
        <Icon className="h-4 w-4 text-primary shrink-0" />
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      <div className="p-5 grid grid-cols-1 gap-4">{children}</div>
    </div>
  );
}

function F({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</Label>
      {children}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════ */
export default function SalomaoOrchestrator() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { createTask } = useAgentTasks();
  const { getHistory, saveMessage, clearHistory } = useAgentChat();

  const [tab, setTab] = useState<'equipe' | 'gerador' | 'pipeline' | 'fluxo' | 'conhecimento'>('gerador');
  const [showGuide, setShowGuide] = useState(() => localStorage.getItem('salomao_guide_dismissed') !== 'true');
  const [activeBriefingId, setActiveBriefingId] = useState<string | null>(null);
  const [activeClientName, setActiveClientName] = useState('Selecione um cliente');
  const [aiProvider, setAiProvider] = useState('openai');

  const [sections, setSections] = useState<BriefingSection[]>([]);
  const [data, setData] = useState<Record<string, string>>({});
  const [niche, setNiche] = useState<string | null>(null);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const storedNiche = localStorage.getItem(`quiz_niche_${user.id}`);
      setNiche(storedNiche);
      
      setIsLoadingTemplate(true);
      try {
        // 1. Busca o histórico para encontrar a estratégia gerada no Quiz
        const history = await getHistory('salomao');
        const quizStrategy = [...history].reverse().find(
          m => m.role === 'assistant' && 
          m.metadata?.type === 'generated_prompt' && 
          m.metadata?.source === 'quiz'
        );

        // 2. Busca o template base para servir de contexto para a IA
        let baseContent = '';
        const baseResp = await fetch('/docs/prompt_brieffing.md');
        if (baseResp.ok) baseContent = await baseResp.text();

        // 3. Invoca o Agente de Montagem (Edge Function) para criar as perguntas dinâmicas
        const { data: aiResponse, error } = await supabase.functions.invoke('prompt-generator-api', {
          body: { 
            action: 'build_questionnaire', 
            niche: storedNiche || 'Geral',
            base_template: baseContent,
            ai_provider: aiProvider,
            context: quizStrategy?.content || '' // Passa o briefing do quiz como contexto estratégico
          }
        });

        if (error) throw error;

        if (aiResponse && aiResponse.sections) {
          const parsedSections: BriefingSection[] = aiResponse.sections;
          setSections(parsedSections);
          
          const initialData: Record<string, string> = {};
          parsedSections.forEach(s => s.fields.forEach(f => {
            initialData[f.key] = '';
          }));
          setData(initialData);
        } else {
          // Fallback para o parsing estático se a IA falhar
          const parsed = parseBriefingTemplate(baseContent);
          setSections(parsed);
          const initialData: Record<string, string> = {};
          parsed.forEach(s => s.fields.forEach(f => {
            initialData[f.key] = '';
          }));
          setData(initialData);
        }
      } catch (err) {
        console.error('Falha ao carregar briefing dinâmico:', err);
        toast({ title: 'Aviso', description: 'Usando template padrão. O Agente de Briefing pode estar offline.', variant: 'destructive' });
      } finally {
        setIsLoadingTemplate(false);
      }
    };

    loadData();
  }, [aiProvider]); // Recarrega se o provedor de IA mudar

  useEffect(() => {
    const loadHistory = async () => {
      const history = await getHistory('salomao');
      const lastAssistantMessage = [...history].reverse().find(m => m.role === 'assistant' && m.metadata?.type === 'generated_prompt');
      if (lastAssistantMessage) {
        setGeneratedPrompt(lastAssistantMessage.content);
      }
    };
    loadHistory();
  }, [getHistory]);

  const activeCount = AGENTS.filter(a => a.status === 'active').length;
  const requiredFieldsCount = sections.reduce((acc, s) => acc + s.fields.length, 0);
  const filledCount = Object.values(data).filter(v => v?.trim()).length;
  const progressPerc = requiredFieldsCount > 0 ? Math.round((filledCount / requiredFieldsCount) * 100) : 0;

  const setField = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setData(prev => ({ ...prev, [key]: e.target.value }));

  const generate = async () => {
    if (progressPerc < 40) {
      toast({ title: 'Preencha mais campos', description: 'Complete pelo menos 40% do briefing.', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    setGeneratedPrompt('');
    try {
      const briefingText = buildBriefingText(sections, data);
      const taskId = await createTask('salomao', 'generate_prompt', { 
        briefing: briefingText,
        ai_provider: aiProvider 
      });

      const { data: res, error } = await supabase.functions.invoke('prompt-generator-api', {
        body: { 
          action: 'generate_prompt', 
          briefing: briefingText,
          ai_provider: aiProvider,
          task_id: taskId
        }
      });

      if (error) throw error;
      
      if (res?.prompt) {
        setGeneratedPrompt(res.prompt);
        await saveMessage('salomao', 'user', `Gerar prompt completo para: ${niche || 'Geral'}`);
        await saveMessage('salomao', 'assistant', res.prompt, { type: 'generated_prompt' });
        toast({ title: '⚡ Prompt gerado!', description: 'O resultado foi salvo no seu histórico.' });
      }

      if (res?.demo) {
        toast({ title: 'Modo demo', description: 'Configure OpenAI API Key no Supabase para IA real.' });
      }
      
      setTimeout(() => outputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const handleClearHistory = async () => {
    try {
      await clearHistory('salomao');
      setGeneratedPrompt('');
      toast({ title: 'Histórico limpo', description: 'Todas as gerações anteriores do Salomão foram removidas.' });
    } catch (err: any) {
      toast({ title: 'Erro ao limpar', description: err.message, variant: 'destructive' });
    }
  };

  const copy = async () => {
    if (!generatedPrompt) return;
    await navigator.clipboard.writeText(generatedPrompt);
    setCopied(true);
    toast({ title: 'Copiado!', description: 'Prompt copiado para a área de transferência.' });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-6xl mx-auto">
        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="text-center space-y-3 py-4">
          <div className="flex items-center justify-center gap-3">
            <Sparkles className="h-8 w-8 text-yellow-400" />
            <h1 className="text-3xl font-bold tracking-tight">SALOMÃO</h1>
            <Sparkles className="h-8 w-8 text-yellow-400" />
          </div>
          <p className="text-muted-foreground">A Agência de Marketing Digital do Futuro</p>
          <div className="flex items-center justify-center gap-3 pt-1 flex-wrap">
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 px-3 py-1">
              <CheckCircle className="h-3.5 w-3.5 mr-1.5" />{activeCount} agentes ativos
            </Badge>
          </div>
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────── */}
        <div className="flex gap-1 rounded-xl bg-muted/50 p-1 w-fit mx-auto">
          {([
            { key: 'equipe', label: '🤖 Equipe' },
            { key: 'gerador', label: '⚡ Gerador' },
            { key: 'conhecimento', label: '🧠 Agentes' },
            { key: 'pipeline', label: '🚀 Etapas' },
            { key: 'fluxo', label: '🗺️ Funil' },
          ] as const).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${tab === t.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ══════════════════════ TAB: EQUIPE ══════════════════════ */}
        {tab === 'equipe' && (
          <div className="space-y-6">

            {/* ── Por onde começar ── */}
            {showGuide && (
              <div className="relative rounded-2xl border border-yellow-500/30 bg-gradient-to-br from-yellow-500/8 to-amber-500/5 p-6">
                <button
                  onClick={() => { setShowGuide(false); localStorage.setItem('salomao_guide_dismissed', 'true'); }}
                  className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>

                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="h-5 w-5 text-yellow-400" />
                  <h2 className="text-lg font-bold text-foreground">Por onde começar?</h2>
                </div>

                <div className="grid gap-4 sm:grid-cols-3 mb-5">
                  {[
                    {
                      step: '1',
                      emoji: '📋',
                      title: 'Cadastre seu negócio',
                      description: 'Responda algumas perguntas sobre sua empresa. O Salomão cria um prompt completo para todos os agentes.',
                      action: () => setTab('gerador'),
                      cta: 'Ir para o Gerador',
                    },
                    {
                      step: '2',
                      emoji: '🤖',
                      title: 'Escolha um agente',
                      description: 'Cada agente tem uma especialidade. Paulo escreve, Maria cria imagens, José gerencia seus anúncios.',
                      action: null,
                      cta: 'Role para ver os agentes',
                    },
                    {
                      step: '3',
                      emoji: '📊',
                      title: 'Acompanhe os resultados',
                      description: 'Veja as métricas dos seus anúncios, leads capturados e performance em tempo real.',
                      action: () => navigate('/metrics'),
                      cta: 'Ver Dashboard',
                    },
                  ].map((item) => (
                    <div key={item.step} className="flex flex-col gap-3 rounded-xl border border-border/40 bg-background/50 p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-yellow-500/20 text-sm font-bold text-yellow-400">
                          {item.step}
                        </div>
                        <span className="text-xl">{item.emoji}</span>
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-foreground">{item.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{item.description}</p>
                      </div>
                      {item.action && (
                        <button
                          onClick={item.action}
                          className="flex items-center gap-1.5 text-xs font-semibold text-yellow-400 hover:text-yellow-300 transition-colors mt-auto"
                        >
                          {item.cta} <ArrowRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <Button
                  onClick={() => setTab('gerador')}
                  className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold"
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Começar agora — Configurar meus agentes
                </Button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {AGENTS.map((agent) => {
                const Icon = agent.icon;
                const isActive = agent.status === 'active';
                const isSelf = agent.id === 'salomao';
                return (
                  <Card
                    key={agent.id}
                    className={`border transition-all duration-200 ${agent.bg} ${isActive && !isSelf ? 'cursor-pointer hover:scale-[1.02] hover:shadow-lg' : isSelf ? 'ring-1 ring-yellow-500/30' : 'opacity-70'}`}
                    onClick={() => isActive && !isSelf && agent.url && navigate(agent.url)}
                  >
                    <CardContent className="p-5 space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${agent.bg} border`}>
                            <Icon className={`h-5 w-5 ${agent.color}`} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className={`font-bold text-base ${agent.color}`}>{agent.name}</h3>
                              {isActive ? (
                                <span className="relative flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                                </span>
                              ) : (
                                <Lock className="h-3 w-3 text-muted-foreground" />
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground font-medium">{agent.role}</p>
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{agent.description}</p>
                      {isActive && !isSelf && (
                        <div className="flex items-center gap-1 text-xs font-medium">
                          <span className={agent.color}>Acessar agente →</span>
                        </div>
                      )}
                      {isSelf && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setTab('gerador'); }}
                          className="flex items-center gap-1.5 text-xs font-medium text-yellow-400 hover:text-yellow-300 transition-colors"
                        >
                          <FileCode2 className="h-3.5 w-3.5" /> Configurar Prompt →
                        </button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card className="border-border/50 bg-card/50">
              <CardContent className="p-6">
                <h3 className="text-sm font-semibold text-muted-foreground mb-4 text-center text-primary italic">"A força do coletivo supera a genialidade individual."</h3>
                <div className="font-mono text-xs text-muted-foreground space-y-1 text-center">
                  <p className="text-yellow-400 font-bold">👑 SALOMÃO (Orquestrador)</p>
                  <p>│</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center max-w-2xl mx-auto">
                    {[
                      { color: 'text-emerald-400', name: '├── JOSÉ', role: 'Tráfego' },
                      { color: 'text-blue-400', name: '├── PAULO', role: 'Copy' },
                      { color: 'text-purple-400', name: '├── MARIA', role: 'Design' },
                      { color: 'text-cyan-400', name: '├── DANIEL', role: 'Estratégia' },
                      { color: 'text-pink-400', name: '├── DAVI', role: 'Social' },
                      { color: 'text-indigo-400', name: '├── JOÃO', role: 'Email' },
                      { color: 'text-teal-400', name: '└── PEDRO', role: 'SDR' },
                    ].map(a => (
                      <div key={a.name} className="space-y-0.5 border border-white/5 p-2 rounded bg-white/5">
                        <p className={a.color + " font-bold"}>{a.name.replace('├── ', '').replace('└── ', '')}</p>
                        <p className="text-[9px] opacity-60 uppercase">{a.role}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ══════════════════════ TAB: GERADOR ══════════════════════ */}
        {tab === 'gerador' && (
          <div className="space-y-5">
            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-5 py-4 flex flex-col sm:flex-row items-center gap-3">
              <div className="flex items-center gap-3 mr-auto">
                <FileCode2 className="h-5 w-5 text-yellow-400 shrink-0" />
                <div>
                  <p className="font-semibold text-sm text-yellow-400">Gerador de Prompt IA</p>
                  <p className="text-[11px] text-muted-foreground line-clamp-1">Personalize o comportamento do seu agente com base no seu nicho.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Select value={aiProvider} onValueChange={setAiProvider} disabled={generating}>
                  <SelectTrigger className="w-[160px] h-9 text-[11px] bg-background/50 border-yellow-500/20 focus:ring-yellow-500/50">
                    <SelectValue placeholder="Selecione a IA" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">ChatGPT (GPT-4o)</SelectItem>
                    <SelectItem value="anthropic_sonnet">Claude 3.5 Sonnet</SelectItem>
                    <SelectItem value="anthropic_haiku">Claude 3 Haiku</SelectItem>
                  </SelectContent>
                </Select>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={async () => {
                    const { data: { user } } = await supabase.auth.getUser();
                    if (user) {
                      localStorage.removeItem(`quiz_completed_${user.id}`);
                      localStorage.removeItem(`quiz_niche_${user.id}`);
                    }
                    navigate('/niche-quiz');
                  }} 
                  className="h-9 px-3 text-xs text-muted-foreground hover:text-primary gap-2"
                >
                  <Target className="h-3.5 w-3.5" /> Refazer Quiz
                </Button>
                {generatedPrompt && (
                  <Button variant="ghost" size="sm" onClick={handleClearHistory} className="h-9 px-3 text-xs text-muted-foreground hover:text-destructive gap-2">
                    <Zap className="h-3 w-3" /> Limpar
                  </Button>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border/50 bg-card/40 p-4">
              <div className="flex justify-between text-xs mb-2">
                <span className="text-muted-foreground">Progresso do Briefing ({niche || 'Geral'})</span>
                <span className={`font-bold ${progressPerc >= 80 ? 'text-green-400' : progressPerc >= 40 ? 'text-yellow-400' : 'text-muted-foreground'}`}>
                  {progressPerc}% ({filledCount}/{requiredFieldsCount})
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${progressPerc >= 80 ? 'bg-green-500' : progressPerc >= 40 ? 'bg-yellow-500' : 'bg-primary'}`}
                  style={{ width: `${progressPerc}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <div className="flex flex-col gap-4">
                {isLoadingTemplate ? (
                  <div className="flex flex-col items-center justify-center p-12 text-muted-foreground italic gap-4">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <p className="text-sm">Adaptando para o nicho {niche}...</p>
                  </div>
                ) : sections.map((section, sIdx) => {
                  const sectionIcons = [ShoppingBag, Palette, Users, TrendingUp, Target, MessageSquare, Shield, Globe];
                  const Icon = sectionIcons[sIdx] || MessageSquare;
                  return (
                    <SectionCard key={sIdx} num={sIdx + 1} icon={Icon} title={section.title}>
                      {section.fields.map((field) => (
                        <F key={field.key} label={field.label} hint={field.hint}>
                          {field.hint.length > 50 || field.label.toLowerCase().includes('dor') || field.label.toLowerCase().includes('desejo') || field.label.toLowerCase().includes('objetivos') ? (
                            <Textarea 
                              value={data[field.key] || ''} 
                              onChange={setField(field.key)} 
                              placeholder="Descreva detalhadamente..."
                              className="min-h-[80px]"
                            />
                          ) : (
                            <Input 
                              value={data[field.key] || ''} 
                              onChange={setField(field.key)} 
                              placeholder="Especifique..."
                            />
                          )}
                        </F>
                      ))}
                    </SectionCard>
                  );
                })}

                <Button
                  className="w-full h-14 text-base font-bold gap-2 bg-yellow-500 hover:bg-yellow-400 text-black shadow-lg shadow-yellow-500/10"
                  onClick={generate}
                  disabled={generating || progressPerc < 40}
                >
                  {generating ? (
                    <><Loader2 className="h-5 w-5 animate-spin" /> Gerando Prompt...</>
                  ) : (
                    <><Sparkles className="h-5 w-5" /> Criar System Prompt — {progressPerc}%</>
                  )}
                </Button>
              </div>

              <div ref={outputRef} className="flex flex-col gap-4 lg:sticky lg:top-6">
                <div className="rounded-xl border border-yellow-500/20 bg-card/40 overflow-hidden shadow-xl">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-border/40 bg-card/60">
                    <div className="flex items-center gap-2">
                       <span className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Prompt do Agente</span>
                    </div>
                    {generatedPrompt && (
                      <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs font-bold" onClick={copy}>
                        {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                        {copied ? 'Copiado!' : 'Copiar'}
                      </Button>
                    )}
                  </div>
                  <div className="min-h-[400px] max-h-[70vh] overflow-y-auto bg-black/20">
                    {!generatedPrompt && !generating && (
                      <div className="flex flex-col items-center justify-center h-[400px] text-center px-10 gap-4 opacity-40">
                        <BotIcon className="h-12 w-12" />
                        <p className="text-sm font-medium">Aguardando briefing...</p>
                      </div>
                    )}
                    {generating && (
                      <div className="flex flex-col items-center justify-center h-[400px] gap-4">
                        <Sparkles className="h-10 w-10 text-yellow-400 animate-pulse" />
                        <div className="space-y-1 text-center">
                          <p className="text-sm font-medium text-yellow-400">Salomão está orquestrando...</p>
                          <p className="text-[10px] text-muted-foreground">Construindo as regras do seu novo agente</p>
                        </div>
                      </div>
                    )}
                    {generatedPrompt && !generating && (
                      <div className="p-6">
                        <pre className="text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/90 font-mono">
                          {generatedPrompt}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-border/40 bg-muted/20 p-4 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Onde usar este prompt?</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {['WhatsApp', 'ManyChat', 'n8n', 'Make', 'ChatGPT', 'Claude'].map(tool => (
                      <div key={tool} className="flex items-center gap-2 text-[11px] text-muted-foreground bg-background/40 px-2 py-1.5 rounded-lg border border-white/5">
                        <Check className="h-3 w-3 text-yellow-500" /> {tool}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════ TAB: PIPELINE ══════════════════════ */}
        {tab === 'pipeline' && (
          <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 flex items-start gap-4">
              <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0 border border-amber-500/20">
                <Zap className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="font-semibold text-sm text-amber-400">Orquestração de Fluxo</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Gerencie a execução automática entre agentes. Salomão coordena Daniel (Estratégia), Paulo (Copy) e Maria (Design) em um fluxo contínuo de aprovação e execução.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="space-y-4">
                <BriefingSmartUpload onBriefingSaved={(id, name) => { setActiveBriefingId(id); setActiveClientName(name); }} />
                <div className="rounded-xl border border-border/40 bg-muted/20 p-4">
                  <h4 className="text-xs font-bold text-muted-foreground mb-3 uppercase tracking-wider">Hierarquia de Comando</h4>
                  <div className="space-y-3 font-mono text-[10px]">
                    <div className="flex items-center gap-2 text-yellow-400"><Sparkles className="h-3 w-3"/> Salomão Orquestra</div>
                    <div className="ml-4 border-l border-white/10 pl-4 space-y-2">
                       <div className="text-cyan-400">Daniel Estrutura</div>
                       <div className="text-blue-400">Paulo Redige</div>
                       <div className="text-purple-400">Maria Desenha</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="lg:col-span-2">
                <OrchestrationPanel briefingId={activeBriefingId} clientName={activeClientName} />
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════ TAB: FLUXO DE VENDAS ══════════════════════ */}
        {tab === 'fluxo' && (
          <div className="space-y-4 animate-in fade-in duration-500">
             <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-5 py-4">
                <h3 className="font-bold text-sm text-amber-400 mb-1 flex items-center gap-2">
                  <Target className="h-4 w-4" /> Engenharia de Funis
                </h3>
                <p className="text-xs text-muted-foreground">Mapeie visualmente a jornada do seu cliente e defina os gatilhos para cada agente de IA.</p>
             </div>
             <FunnelFlowchart />
          </div>
        )}

        {/* ══════════════════════ TAB: CONHECIMENTO ══════════════════════ */}
        {tab === 'conhecimento' && (
          <div className="space-y-4 animate-in fade-in duration-500">
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-4 flex items-start gap-3">
              <BrainCircuit className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm text-primary">Cérebro da Agência</p>
                <p className="text-xs text-muted-foreground mt-0.5">Defina o que cada agente sabe. Alimente a memória de longo prazo com PDFs, sites e documentos do seu cliente.</p>
              </div>
            </div>
            <AgentKnowledgeBase agents={AGENTS} />
          </div>
        )}
      </div>
    </MainLayout>
  );
}
