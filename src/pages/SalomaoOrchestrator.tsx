import { useState, useRef } from 'react';
import { OrchestrationPanel } from '@/components/salomao/OrchestrationPanel';
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
} from 'lucide-react';

/* ── Agent definitions ──────────────────────────────────────────────── */
const AGENTS = [
  { id: 'salomao', name: 'SALOMÃO', role: 'Orquestrador', icon: Sparkles, description: 'Coordena todos os agentes. Recebe o briefing do cliente e distribui tarefas.', status: 'active', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20', url: '/salomao' },
  { id: 'jose', name: 'JOSÉ', role: 'Tráfego Pago', icon: Radar, description: 'Gerencia Meta Ads, Google Ads e TikTok com autonomia total. Analisa, otimiza, pausa e escala campanhas.', status: 'active', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', url: '/apollo' },
  { id: 'paulo', name: 'PAULO', role: 'Copywriter', icon: PenTool, description: 'Escreve headlines, body copy, CTAs, scripts de vídeo e sequências de email que convertem.', status: 'active', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', url: '/copywriter' },
  { id: 'maria', name: 'MARIA', role: 'Designer', icon: Palette, description: 'Cria imagens, banners e criativos com IA. Remove fundo, redimensiona e gera variações.', status: 'active', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20', url: '/creative-studio' },
  { id: 'daniel', name: 'DANIEL', role: 'Estrategista', icon: Brain, description: 'Analisa mercado, concorrentes e posicionamento. Define personas, ângulos e plano de 90 dias.', status: 'active', color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20', url: '/daniel' },
  { id: 'davi', name: 'DAVI', role: 'Social Media', icon: Send, description: 'Cria calendário editorial, escreve legendas e publica automaticamente no melhor horário.', status: 'active', color: 'text-pink-400', bg: 'bg-pink-500/10 border-pink-500/20', url: '/davi' },
  { id: 'lucas', name: 'LUCAS', role: 'Gestor de Funil', icon: Layers, description: 'Mapeia e otimiza toda a jornada do cliente: anúncio → landing page → checkout → retenção.', status: 'coming', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20', url: null },
  { id: 'joao', name: 'JOÃO', role: 'Email Marketing', icon: Megaphone, description: 'Cria sequências de nutrição, segmenta listas e envia campanhas no timing certo.', status: 'active', color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20', url: '/joao' },
  { id: 'marcos', name: 'MARCOS', role: 'Gestor de Leads', icon: Users, description: 'Gerencia leads, funil de vendas e conversões. Mini-CRM integrado com WhatsApp.', status: 'active', color: 'text-teal-400', bg: 'bg-teal-500/10 border-teal-500/20', url: '/leads' },
  { id: 'pedro', name: 'PEDRO', role: 'SDR & Atendimento', icon: Bot, description: 'Qualifica leads, agenda reuniões e responde clientes 24/7 via WhatsApp com inteligência humana.', status: 'active', color: 'text-teal-400', bg: 'bg-teal-500/10 border-teal-500/20', url: '/whatsapp/ai-agent' },
];

/* ── Prompt Generator types ─────────────────────────────────────────── */
interface BriefingData {
  vendeProduto: string; problemaResolve: string; transformacao: string; diferencial: string;
  perfilCliente: string; dor: string; desejo: string; objecoes: string; triggerCompra: string;
  produto: string; preco: string; beneficios: string; mecanismo: string; garantia: string; prazoResultado: string;
  ondeVende: string; canais: string; funil: string; objetivo: string;
  tom: string; girias: string; humor: string; referencia: string;
  resultados: string; autoridade: string; depoimento: string;
  devesFazer: string; naoFazer: string; cta: string; nomeAgente: string;
}
const EMPTY_BRIEFING: BriefingData = {
  vendeProduto: '', problemaResolve: '', transformacao: '', diferencial: '',
  perfilCliente: '', dor: '', desejo: '', objecoes: '', triggerCompra: '',
  produto: '', preco: '', beneficios: '', mecanismo: '', garantia: '', prazoResultado: '',
  ondeVende: '', canais: '', funil: '', objetivo: '',
  tom: '', girias: 'não usar gírias', humor: 'sem humor', referencia: '',
  resultados: '', autoridade: '', depoimento: '',
  devesFazer: '', naoFazer: '', cta: '', nomeAgente: '',
};
const REQUIRED_FIELDS: (keyof BriefingData)[] = [
  'vendeProduto', 'problemaResolve', 'transformacao', 'diferencial',
  'perfilCliente', 'dor', 'desejo', 'objecoes', 'triggerCompra',
  'produto', 'preco', 'beneficios', 'mecanismo',
  'ondeVende', 'canais', 'objetivo', 'tom', 'devesFazer', 'naoFazer', 'cta',
];
function buildBriefingText(d: BriefingData) {
  return `NEGÓCIO: ${d.vendeProduto}\nProblema resolve: ${d.problemaResolve}\nTransformação: ${d.transformacao}\nDiferencial único: ${d.diferencial}\n\nCLIENTE IDEAL:\nPerfil: ${d.perfilCliente}\nDor principal: ${d.dor}\nMaior desejo: ${d.desejo}\nObjeções: ${d.objecoes}\nGatilho de compra: ${d.triggerCompra}\n\nOFERTA:\nProduto: ${d.produto} | Preço: ${d.preco}\nBenefícios: ${d.beneficios}\nMecanismo único: ${d.mecanismo}\nGarantia/bônus: ${d.garantia} | Prazo resultado: ${d.prazoResultado}\n\nAQUISIÇÃO:\nCanal de venda: ${d.ondeVende}\nCanais de tráfego: ${d.canais}\nFunil atual: ${d.funil}\nObjetivo do agente: ${d.objetivo}\n\nCOMUNICAÇÃO:\nTom de voz: ${d.tom}\nGírias: ${d.girias} | Humor: ${d.humor}\nReferência de estilo: ${d.referencia || 'não especificada'}\n\nAUTORIDADE:\nResultados: ${d.resultados}\nAutoridade/tempo: ${d.autoridade}\nDepoimento: ${d.depoimento}\n\nREGRAS:\nDeve fazer: ${d.devesFazer}\nNÃO pode fazer: ${d.naoFazer}\nCTA principal: ${d.cta}\nNome do agente: ${d.nomeAgente || 'não especificado'}`.trim();
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
      {hint && <p className="text-[10px] text-muted-foreground italic">{hint}</p>}
    </div>
  );
}
function R2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>;
}

/* ════════════════════════════════════════════════════════════════════ */
export default function SalomaoOrchestrator() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [tab, setTab] = useState<'equipe' | 'gerador' | 'pipeline'>('gerador');
  const [activeBriefingId, setActiveBriefingId] = useState<string | null>(null);
  const [activeClientName, setActiveClientName] = useState('Selecione um cliente');

  /* ── Prompt generator state ── */
  const [data, setData] = useState<BriefingData>(EMPTY_BRIEFING);
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  const activeCount = AGENTS.filter(a => a.status === 'active').length;
  const filled = REQUIRED_FIELDS.filter(f => data[f]?.trim()).length;
  const progress = Math.round((filled / REQUIRED_FIELDS.length) * 100);

  const set = (key: keyof BriefingData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setData(prev => ({ ...prev, [key]: e.target.value }));
  const setSel = (key: keyof BriefingData) => (val: string) =>
    setData(prev => ({ ...prev, [key]: val }));

  const generate = async () => {
    if (progress < 40) {
      toast({ title: 'Preencha mais campos', description: 'Complete pelo menos 40% do briefing.', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    setGeneratedPrompt('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão expirada.');
      const res = await supabase.functions.invoke('prompt-generator-api', {
        body: { action: 'generate_prompt', briefing: buildBriefingText(data) },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.error) throw new Error(res.error.message);
      const result = res.data as { prompt: string; tokens_used: number; demo: boolean };
      setGeneratedPrompt(result.prompt);
      if (result.demo) {
        toast({ title: 'Modo demo', description: 'Configure ANTHROPIC_API_KEY no Supabase para IA real.' });
      } else {
        toast({ title: '⚡ Prompt gerado!', description: `${result.tokens_used?.toLocaleString('pt-BR')} tokens usados.` });
      }
      setTimeout(() => outputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setGenerating(false);
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
          <p className="text-sm text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            10 agentes especializados de IA trabalhando em equipe. Cada um é um especialista completo na sua área —
            juntos formam a primeira agência 100% autônoma do Brasil.
          </p>
          <div className="flex items-center justify-center gap-3 pt-1 flex-wrap">
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 px-3 py-1">
              <CheckCircle className="h-3.5 w-3.5 mr-1.5" />{activeCount} agentes ativos
            </Badge>
            <Badge variant="outline" className="text-muted-foreground px-3 py-1">
              {AGENTS.length - activeCount} em desenvolvimento
            </Badge>
          </div>
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────── */}
        <div className="flex gap-1 rounded-xl bg-muted/50 p-1 w-fit mx-auto">
          {([
            { key: 'equipe', label: '🤖 Equipe de Agentes' },
            { key: 'gerador', label: '⚡ Gerador de Prompt IA' },
            { key: 'pipeline', label: '🚀 Fluxo Organizado de Etapas' },
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
          <>
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
                        <Badge variant="outline" className={isActive ? 'text-[10px] text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-[10px] text-muted-foreground'}>
                          {isActive ? 'Ativo' : 'Em breve'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{agent.description}</p>
                      {isActive && !isSelf && (
                        <div className="flex items-center gap-1 text-xs font-medium">
                          <span className={agent.color}>Acessar agente →</span>
                        </div>
                      )}
                      {isSelf && (
                        <button
                          onClick={() => setTab('gerador')}
                          className="flex items-center gap-1.5 text-xs font-medium text-yellow-400 hover:text-yellow-300 transition-colors"
                        >
                          <FileCode2 className="h-3.5 w-3.5" /> Gerar Prompt para Agente →
                        </button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Architecture */}
            <Card className="border-border/50 bg-card/50">
              <CardContent className="p-6">
                <h3 className="text-sm font-semibold text-muted-foreground mb-4 text-center">ARQUITETURA DA EQUIPE</h3>
                <div className="font-mono text-xs text-muted-foreground space-y-1 text-center">
                  <p className="text-yellow-400 font-bold">👑 SALOMÃO (Orquestrador)</p>
                  <p>│</p>
                  <div className="grid grid-cols-3 gap-2 text-center max-w-xl mx-auto">
                    {[
                      { color: 'text-emerald-400', name: '├── JOSÉ', role: 'Tráfego Pago' },
                      { color: 'text-blue-400', name: '├── PAULO', role: 'Copywriter' },
                      { color: 'text-purple-400', name: '├── MARIA', role: 'Design' },
                      { color: 'text-cyan-400', name: '├── DANIEL', role: 'Estratégia' },
                      { color: 'text-pink-400', name: '├── DAVI', role: 'Social Media' },
                      { color: 'text-orange-400', name: '├── LUCAS', role: 'Funil' },
                      { color: 'text-indigo-400', name: '├── JOÃO', role: 'Email' },
                      { color: 'text-teal-400', name: '├── MARCOS', role: 'Leads' },
                      { color: 'text-teal-400', name: '└── PEDRO', role: 'Atendimento' },
                    ].map(a => (
                      <div key={a.name} className="space-y-1">
                        <p className={a.color}>{a.name}</p>
                        <p className="text-[10px]">{a.role}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* ══════════════════════ TAB: GERADOR ══════════════════════ */}
        {tab === 'gerador' && (
          <div className="space-y-5">
            {/* Sub-header */}
            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-5 py-4 flex items-start gap-3">
              <FileCode2 className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm text-yellow-400">Gerador de Prompt para Agente de Vendas</p>
                <p className="text-xs text-muted-foreground mt-0.5">Preencha o briefing do negócio e o SALOMÃO gera um System Prompt completo, pronto para colar no WhatsApp, ChatGPT, Claude ou qualquer automação.</p>
              </div>
            </div>

            {/* Progress */}
            <div className="rounded-xl border border-border/50 bg-card/40 p-4">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Briefing preenchido</span>
                <span className={`font-bold ${progress >= 80 ? 'text-green-400' : progress >= 40 ? 'text-yellow-400' : 'text-muted-foreground'}`}>
                  {progress}% · {filled}/{REQUIRED_FIELDS.length} campos
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${progress >= 80 ? 'bg-green-500' : progress >= 40 ? 'bg-yellow-500' : 'bg-primary'}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">Mínimo 40% para gerar · Mais campos = prompt mais poderoso</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* ── LEFT: FORM ─────────────────────────────────────── */}
              <div className="flex flex-col gap-5">

                <SectionCard num={1} icon={ShoppingBag} title="Negócio & Posicionamento">
                  <F label="O que você vende?" hint="Ex: Curso online de tráfego pago para iniciantes">
                    <Input value={data.vendeProduto} onChange={set('vendeProduto')} placeholder="Descreva seu produto ou serviço" />
                  </F>
                  <F label="Qual problema resolve?">
                    <Textarea value={data.problemaResolve} onChange={set('problemaResolve')} placeholder="Ex: Pessoas que tentam anunciar no Meta Ads mas perdem dinheiro sem retorno" className="min-h-[70px]" />
                  </F>
                  <F label="Qual transformação entrega?">
                    <Textarea value={data.transformacao} onChange={set('transformacao')} placeholder="Ex: O aluno cria campanhas lucrativas em 30 dias mesmo sem experiência" className="min-h-[70px]" />
                  </F>
                  <F label="Diferencial único">
                    <Textarea value={data.diferencial} onChange={set('diferencial')} placeholder="Ex: Único método com suporte diário via WhatsApp" className="min-h-[60px]" />
                  </F>
                </SectionCard>

                <SectionCard num={2} icon={Users} title="Cliente Ideal (ICP)">
                  <F label="Perfil geral">
                    <Input value={data.perfilCliente} onChange={set('perfilCliente')} placeholder="Ex: Empreendedores 25–45 anos, MEI ou autônomos" />
                  </F>
                  <F label="Principal dor (emocional e prática)">
                    <Textarea value={data.dor} onChange={set('dor')} placeholder="Ex: Frustração de investir em anúncios sem vender. Medo de perder dinheiro." className="min-h-[60px]" />
                  </F>
                  <F label="Maior desejo">
                    <Input value={data.desejo} onChange={set('desejo')} placeholder="Ex: Ter previsibilidade de vendas e escalar" />
                  </F>
                  <F label="Principais objeções">
                    <Textarea value={data.objecoes} onChange={set('objecoes')} placeholder="Ex: 'É muito caro', 'não tenho tempo', 'já tentei'" className="min-h-[60px]" />
                  </F>
                  <F label="O que faria comprar agora?">
                    <Input value={data.triggerCompra} onChange={set('triggerCompra')} placeholder="Ex: Desconto por tempo limitado + garantia de 7 dias" />
                  </F>
                </SectionCard>

                <SectionCard num={3} icon={TrendingUp} title="Oferta">
                  <R2>
                    <F label="Produto / Serviço"><Input value={data.produto} onChange={set('produto')} placeholder="Nome do produto" /></F>
                    <F label="Preço"><Input value={data.preco} onChange={set('preco')} placeholder="Ex: R$ 997 ou 12x R$ 97" /></F>
                  </R2>
                  <F label="Benefícios principais">
                    <Textarea value={data.beneficios} onChange={set('beneficios')} placeholder="Ex: Aulas gravadas + mentorias ao vivo + templates prontos" className="min-h-[60px]" />
                  </F>
                  <F label="Mecanismo único (por que funciona)">
                    <Textarea value={data.mecanismo} onChange={set('mecanismo')} placeholder="Ex: Método P.A.C.E.: 4 etapas para campanhas lucrativas" className="min-h-[60px]" />
                  </F>
                  <R2>
                    <F label="Garantia / Bônus"><Input value={data.garantia} onChange={set('garantia')} placeholder="Ex: 7 dias + bônus masterclass" /></F>
                    <F label="Prazo de resultado"><Input value={data.prazoResultado} onChange={set('prazoResultado')} placeholder="Ex: Resultados em 14 dias" /></F>
                  </R2>
                </SectionCard>

                <SectionCard num={4} icon={Target} title="Aquisição & Funil">
                  <R2>
                    <F label="Onde vende hoje?"><Input value={data.ondeVende} onChange={set('ondeVende')} placeholder="Ex: Instagram, WhatsApp, Hotmart" /></F>
                    <F label="Canais principais"><Input value={data.canais} onChange={set('canais')} placeholder="Ex: Orgânico + Meta Ads" /></F>
                  </R2>
                  <F label="Como funciona o funil atual?">
                    <Textarea value={data.funil} onChange={set('funil')} placeholder="Ex: Lead cai no WhatsApp → sequência → CTA para página" className="min-h-[60px]" />
                  </F>
                  <F label="Objetivo principal do agente">
                    <Select value={data.objetivo} onValueChange={setSel('objetivo')}>
                      <SelectTrigger><SelectValue placeholder="— Selecione —" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gerar lead qualificado">Gerar lead qualificado</SelectItem>
                        <SelectItem value="fechar venda diretamente">Fechar venda diretamente</SelectItem>
                        <SelectItem value="agendar uma call de vendas">Agendar call de vendas</SelectItem>
                        <SelectItem value="qualificar e direcionar ao time comercial">Qualificar e direcionar ao time</SelectItem>
                        <SelectItem value="nutrir e engajar o lead">Nutrir e engajar lead</SelectItem>
                      </SelectContent>
                    </Select>
                  </F>
                </SectionCard>

                <SectionCard num={5} icon={MessageSquare} title="Comunicação & Tom">
                  <F label="Tom de voz">
                    <Select value={data.tom} onValueChange={setSel('tom')}>
                      <SelectTrigger><SelectValue placeholder="— Selecione —" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="direto e energético (estilo Gary Vaynerchuk)">Direto e energético (Gary Vee)</SelectItem>
                        <SelectItem value="empático e inspirador (estilo Tony Robbins)">Empático e inspirador (Tony Robbins)</SelectItem>
                        <SelectItem value="técnico e educativo">Técnico e educativo</SelectItem>
                        <SelectItem value="descontraído com humor leve">Descontraído com humor</SelectItem>
                        <SelectItem value="agressivo e provocador">Agressivo e provocador</SelectItem>
                        <SelectItem value="sofisticado e premium">Sofisticado e premium</SelectItem>
                        <SelectItem value="amigável e consultivo">Amigável e consultivo</SelectItem>
                      </SelectContent>
                    </Select>
                  </F>
                  <R2>
                    <F label="Pode usar gírias?">
                      <Select value={data.girias} onValueChange={setSel('girias')}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="não usar gírias">Não</SelectItem>
                          <SelectItem value="pode usar gírias com moderação">Sim, com moderação</SelectItem>
                          <SelectItem value="pode usar gírias livremente">Sim, livremente</SelectItem>
                        </SelectContent>
                      </Select>
                    </F>
                    <F label="Pode usar humor?">
                      <Select value={data.humor} onValueChange={setSel('humor')}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sem humor">Não</SelectItem>
                          <SelectItem value="humor sutil e inteligente">Sim, sutil</SelectItem>
                          <SelectItem value="humor leve e descontraído">Sim, descontraído</SelectItem>
                        </SelectContent>
                      </Select>
                    </F>
                  </R2>
                  <F label="Referência de estilo (opcional)">
                    <Input value={data.referencia} onChange={set('referencia')} placeholder="Ex: Joel Jota, Primo Rico, Coppolla Filmes..." />
                  </F>
                </SectionCard>

                <SectionCard num={6} icon={Megaphone} title="Provas & Autoridade">
                  <F label="Resultados / números">
                    <Textarea value={data.resultados} onChange={set('resultados')} placeholder="Ex: +500 alunos, média 3x ROI em 30 dias, R$2M em vendas" className="min-h-[60px]" />
                  </F>
                  <F label="Tempo de mercado + diferenciais reais">
                    <Input value={data.autoridade} onChange={set('autoridade')} placeholder="Ex: 7 anos de mercado, ex-gestor de tráfego da [Empresa]" />
                  </F>
                  <F label="Exemplo de depoimento">
                    <Textarea value={data.depoimento} onChange={set('depoimento')} placeholder="Ex: 'Em 21 dias recuperei o investimento' — João, pet shop SP" className="min-h-[60px]" />
                  </F>
                </SectionCard>

                <SectionCard num={7} icon={Shield} title="Regras do Agente">
                  <F label="O que o agente DEVE fazer?">
                    <Textarea value={data.devesFazer} onChange={set('devesFazer')} placeholder="Ex: Identificar perfil, apresentar oferta naturalmente, contornar objeções, guiar para CTA" className="min-h-[70px]" />
                  </F>
                  <F label="O que NÃO pode fazer?">
                    <Textarea value={data.naoFazer} onChange={set('naoFazer')} placeholder="Ex: Jamais oferecer desconto sem autorização, não prometer resultados garantidos" className="min-h-[60px]" />
                  </F>
                  <F label="CTA principal (para onde levar?)">
                    <Input value={data.cta} onChange={set('cta')} placeholder="Ex: Link da página / WhatsApp / Calendly" />
                  </F>
                  <F label="Nome / identidade do agente (opcional)">
                    <Input value={data.nomeAgente} onChange={set('nomeAgente')} placeholder="Ex: Kira — Especialista em tráfego da [Empresa]" />
                  </F>
                </SectionCard>

                <Button
                  className="w-full h-14 text-base font-bold gap-2 bg-yellow-500 hover:bg-yellow-400 text-black"
                  onClick={generate}
                  disabled={generating || progress < 40}
                >
                  {generating ? (
                    <><Loader2 className="h-5 w-5 animate-spin" /> Salomão está gerando...</>
                  ) : (
                    <><Sparkles className="h-5 w-5" /> Gerar Prompt com SALOMÃO — {progress}%</>
                  )}
                </Button>
                {progress < 40 && (
                  <p className="text-xs text-center text-muted-foreground -mt-2">
                    Preencha mais {40 - progress}% para liberar
                  </p>
                )}
              </div>

              {/* ── RIGHT: OUTPUT ───────────────────────────────────── */}
              <div ref={outputRef} className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
                <div className="rounded-xl border border-yellow-500/20 bg-card/40 overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/40 bg-card/60">
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full transition-colors ${generating ? 'bg-yellow-400 animate-pulse' : generatedPrompt ? 'bg-green-400' : 'bg-muted-foreground'}`} />
                      <span className="font-semibold text-sm">System Prompt Gerado</span>
                    </div>
                    {generatedPrompt && (
                      <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={copy}>
                        {copied ? <><Check className="h-3 w-3 text-green-400" /> Copiado!</> : <><Copy className="h-3 w-3" /> Copiar</>}
                      </Button>
                    )}
                  </div>
                  <div className="min-h-[500px] max-h-[80vh] overflow-y-auto">
                    {!generatedPrompt && !generating && (
                      <div className="flex flex-col items-center justify-center h-[440px] text-center px-8 gap-4">
                        <div className="relative">
                          <Sparkles className="h-14 w-14 text-yellow-400/20" />
                          <Sparkles className="h-6 w-6 text-yellow-400/40 absolute -top-1 -right-1" />
                        </div>
                        <p className="text-muted-foreground text-sm">Preencha o briefing ao lado</p>
                        <p className="text-xs text-muted-foreground">O SALOMÃO vai criar um System Prompt completo e poderoso para seu agente de vendas</p>
                      </div>
                    )}
                    {generating && (
                      <div className="flex flex-col items-center justify-center h-[440px] gap-3">
                        <Sparkles className="h-10 w-10 text-yellow-400 animate-pulse" />
                        <p className="text-sm text-muted-foreground font-medium">SALOMÃO está criando seu agente...</p>
                        <p className="text-xs text-muted-foreground">Analisando briefing e estruturando o prompt</p>
                      </div>
                    )}
                    {generatedPrompt && !generating && (
                      <pre className="p-5 text-sm leading-relaxed whitespace-pre-wrap text-foreground font-sans">
                        {generatedPrompt}
                      </pre>
                    )}
                  </div>
                </div>

                {/* How to use */}
                <div className="rounded-xl border border-border/40 bg-muted/20 p-4">
                  <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                    <ChevronRight className="h-4 w-4 text-yellow-400" /> Como usar o prompt gerado
                  </h4>
                  <ul className="text-xs text-muted-foreground space-y-1.5">
                    <li>📱 <strong>WhatsApp:</strong> Cole na Evolution API / ManyChat / Typebot</li>
                    <li>🤖 <strong>ChatGPT:</strong> Cole em "Custom Instructions" ou GPT personalizado</li>
                    <li>💬 <strong>Claude:</strong> Use como System Prompt via API ou projeto</li>
                    <li>⚙️ <strong>N8n / Make:</strong> Use como system message no nó de IA</li>
                    <li>🔗 <strong>PEDRO (SDR):</strong> Configure diretamente no agente de atendimento</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════ TAB: PIPELINE ══════════════════════ */}
        {tab === 'pipeline' && (
          <div className="space-y-5">
            {/* Sub-header */}
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 flex items-start gap-3">
              <Zap className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm text-amber-400">Fluxo Organizado de Etapas entre Agentes</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Salomão coordena Daniel → Paulo + Maria → Aprovação → José em tempo real, usando o banco de dados como barramento de mensagens.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left: briefing selector */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground">Selecionar Cliente</h3>
                <div className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Para usar o pipeline real, selecione um briefing salvo ou crie um novo pelo Gerador de Prompt IA.
                  </p>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground/80">ID do Briefing (manual)</p>
                    <input
                      type="text"
                      placeholder="Cole o UUID do briefing aqui"
                      className="w-full text-xs px-3 py-2 rounded-lg border border-border/60 bg-background/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                      onChange={(e) => {
                        const val = e.target.value.trim();
                        if (val) {
                          setActiveBriefingId(val);
                          setActiveClientName('Cliente selecionado');
                        } else {
                          setActiveBriefingId(null);
                          setActiveClientName('Selecione um cliente');
                        }
                      }}
                    />
                  </div>
                  {activeBriefingId && (
                    <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <p className="text-[10px] text-emerald-400 font-mono break-all">{activeBriefingId}</p>
                    </div>
                  )}
                </div>

                {/* Architecture reminder */}
                <div className="rounded-xl border border-border/40 bg-muted/20 p-4 space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground">Fluxo Organizado de Etapas</h4>
                  <div className="font-mono text-[10px] text-muted-foreground space-y-1">
                    <p className="text-yellow-400">👑 Salomão (coordena)</p>
                    <p className="ml-2">↓</p>
                    <p className="ml-2 text-cyan-400">🧠 Daniel (estratégia)</p>
                    <p className="ml-2">↓</p>
                    <p className="ml-2 text-blue-400">✍️ Paulo + 🎨 Maria (paralelo)</p>
                    <p className="ml-2">↓</p>
                    <p className="ml-2 text-amber-400">⏸ Approval Gate</p>
                    <p className="ml-2">↓</p>
                    <p className="ml-2 text-emerald-400">🎯 José (campanha)</p>
                  </div>
                </div>
              </div>

              {/* Right: orchestration panel */}
              <div className="lg:col-span-2">
                <OrchestrationPanel briefingId={activeBriefingId} clientName={activeClientName} />
              </div>
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
