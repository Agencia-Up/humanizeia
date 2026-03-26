import { useState, useRef } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Zap, Copy, Check, Bot, Loader2, ChevronRight, Sparkles,
  MessageSquare, Target, ShoppingBag, Users, Megaphone, Settings2,
  Shield, TrendingUp,
} from 'lucide-react';

/* ── types ──────────────────────────────────────────────────────────── */
interface BriefingData {
  // 1. Negócio
  vendeProduto: string; problemaResolve: string;
  transformacao: string; diferencial: string;
  // 2. ICP
  perfilCliente: string; dor: string;
  desejo: string; objecoes: string; triggerCompra: string;
  // 3. Oferta
  produto: string; preco: string; beneficios: string;
  mecanismo: string; garantia: string; prazoResultado: string;
  // 4. Funil
  ondeVende: string; canais: string; funil: string; objetivo: string;
  // 5. Comunicação
  tom: string; girias: string; humor: string; referencia: string;
  // 6. Provas
  resultados: string; autoridade: string; depoimento: string;
  // 7. Regras
  devesFazer: string; naoFazer: string; cta: string; nomeAgente: string;
}

const EMPTY: BriefingData = {
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
  'ondeVende', 'canais', 'objetivo', 'tom',
  'devesFazer', 'naoFazer', 'cta',
];

function buildBriefingText(d: BriefingData): string {
  return `
NEGÓCIO:
O que vende: ${d.vendeProduto}
Problema que resolve: ${d.problemaResolve}
Transformação entregue: ${d.transformacao}
Diferencial único: ${d.diferencial}

CLIENTE IDEAL (ICP):
Perfil: ${d.perfilCliente}
Dor principal (emocional e prática): ${d.dor}
Maior desejo: ${d.desejo}
Principais objeções: ${d.objecoes}
Gatilho de compra: ${d.triggerCompra}

OFERTA:
Produto/Serviço: ${d.produto}
Preço: ${d.preco}
Benefícios principais: ${d.beneficios}
Mecanismo único: ${d.mecanismo}
Garantia/bônus: ${d.garantia}
Prazo de resultado: ${d.prazoResultado}

AQUISIÇÃO E FUNIL:
Onde vende: ${d.ondeVende}
Canais de tráfego: ${d.canais}
Funil atual: ${d.funil}
Objetivo do agente: ${d.objetivo}

COMUNICAÇÃO:
Tom de voz: ${d.tom}
Gírias: ${d.girias}
Humor: ${d.humor}
Referência de estilo: ${d.referencia || 'não especificada'}

AUTORIDADE E PROVAS:
Resultados/números: ${d.resultados}
Autoridade/tempo de mercado: ${d.autoridade}
Depoimento exemplo: ${d.depoimento}

REGRAS DO AGENTE:
Deve fazer: ${d.devesFazer}
NÃO pode fazer: ${d.naoFazer}
CTA principal: ${d.cta}
Nome/identidade do agente: ${d.nomeAgente || 'não especificado'}
  `.trim();
}

/* ── Section wrapper ─────────────────────────────────────────────────── */
function Section({ num, icon: Icon, title, children }: {
  num: number; icon: React.ComponentType<{ className?: string }>;
  title: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border/40 bg-card/60">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
          {num}
        </div>
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      <div className="p-5 grid grid-cols-1 gap-4">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground italic">{hint}</p>}
    </div>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>;
}

/* ════════════════════════════════════════════════════════════════════ */
export default function GeradorPrompt() {
  const { toast } = useToast();
  const [data, setData] = useState<BriefingData>(EMPTY);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [aiProvider, setAiProvider] = useState('openai'); // openai | anthropic
  const outputRef = useRef<HTMLDivElement>(null);

  const filled = REQUIRED_FIELDS.filter(f => data[f]?.trim()).length;
  const progress = Math.round((filled / REQUIRED_FIELDS.length) * 100);

  const set = (key: keyof BriefingData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setData(prev => ({ ...prev, [key]: e.target.value }));

  const setSelect = (key: keyof BriefingData) => (val: string) =>
    setData(prev => ({ ...prev, [key]: val }));

  const generate = async () => {
    if (progress < 40) {
      toast({ title: 'Preencha mais campos', description: 'Complete pelo menos 40% do briefing para gerar.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    setPrompt('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão expirada. Faça login novamente.');

      const res = await supabase.functions.invoke('prompt-generator-api', {
        body: { 
          action: 'generate_prompt', 
          briefing: buildBriefingText(data),
          ai_provider: aiProvider
        },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.error) throw new Error(res.error.message);
      const result = res.data as { prompt: string; tokens_used: number; demo: boolean };
      setPrompt(result.prompt);
      setIsDemo(result.demo ?? false);
      if (result.demo) {
        toast({ title: 'Modo demo ativado', description: 'Configure API_KEY correspondente no Supabase para IA real.' });
      } else {
        toast({ title: 'Prompt gerado!', description: `${result.tokens_used.toLocaleString('pt-BR')} tokens utilizados.` });
      }
      setTimeout(() => outputRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err: any) {
      // Add more context if error is related to API Key
      if (err.message.includes('API error') || err.message.includes('não encontrada')) {
        toast({ title: 'Erro na API da IA', description: err.message + ' (Verifique as Secrets no Supabase)', variant: 'destructive' });
      } else {
        toast({ title: 'Erro ao gerar', description: err.message, variant: 'destructive' });
      }
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    toast({ title: 'Copiado!', description: 'Prompt copiado para a área de transferência.' });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <MainLayout>
      <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bot className="h-6 w-6 text-primary" />
              Gerador de Prompt para Agente de Vendas
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Preencha o briefing → IA gera um system prompt completo e pronto para uso
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 gap-1.5 whitespace-nowrap hidden sm:flex">
              <Sparkles className="h-3 w-3" /> Motor IA
            </Badge>
            <Select value={aiProvider} onValueChange={setAiProvider} disabled={loading}>
              <SelectTrigger className="w-[200px] h-9 text-xs bg-card/60 border-primary/20 focus:ring-primary/50">
                <SelectValue placeholder="Selecione a IA" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">ChatGPT (GPT-4o)</SelectItem>
                <SelectItem value="anthropic_sonnet">Claude 3.5 Sonnet</SelectItem>
                <SelectItem value="anthropic_haiku">Claude 3 Haiku</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── Progress ─────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border/50 bg-card/40 p-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">Briefing preenchido</span>
            <span className={`font-bold ${progress >= 80 ? 'text-green-400' : progress >= 40 ? 'text-yellow-400' : 'text-muted-foreground'}`}>
              {progress}% ({filled}/{REQUIRED_FIELDS.length} campos)
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
          {/* ── FORM ────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-5">

            {/* 1. Negócio */}
            <Section num={1} icon={ShoppingBag} title="Negócio & Posicionamento">
              <Field label="O que você vende?" hint="Ex: Curso online de tráfego pago para iniciantes">
                <Input value={data.vendeProduto} onChange={set('vendeProduto')} placeholder="Descreva seu produto ou serviço" />
              </Field>
              <Field label="Qual problema resolve?">
                <Textarea value={data.problemaResolve} onChange={set('problemaResolve')} placeholder="Ex: Pessoas que tentam anunciar no Meta Ads mas perdem dinheiro sem retorno" className="min-h-[70px]" />
              </Field>
              <Field label="Qual transformação entrega?">
                <Textarea value={data.transformacao} onChange={set('transformacao')} placeholder="Ex: O aluno cria campanhas lucrativas em 30 dias mesmo sem experiência" className="min-h-[70px]" />
              </Field>
              <Field label="Diferencial único">
                <Textarea value={data.diferencial} onChange={set('diferencial')} placeholder="Ex: Único método que ensina tráfego com gestão via WhatsApp + suporte diário" className="min-h-[70px]" />
              </Field>
            </Section>

            {/* 2. ICP */}
            <Section num={2} icon={Users} title="Cliente Ideal (ICP)">
              <Field label="Perfil geral" hint="Idade, profissão, renda, momento de vida">
                <Input value={data.perfilCliente} onChange={set('perfilCliente')} placeholder="Ex: Empreendedores 25–45 anos, MEI ou autônomos" />
              </Field>
              <Field label="Principal dor (emocional e prática)">
                <Textarea value={data.dor} onChange={set('dor')} placeholder="Ex: Frustração de investir em anúncios sem vender. Medo de perder dinheiro." className="min-h-[70px]" />
              </Field>
              <Field label="Maior desejo">
                <Input value={data.desejo} onChange={set('desejo')} placeholder="Ex: Ter previsibilidade de vendas e escalar sem depender de indicação" />
              </Field>
              <Field label="Principais objeções">
                <Textarea value={data.objecoes} onChange={set('objecoes')} placeholder="Ex: 'É muito caro', 'não tenho tempo', 'já tentei e não funcionou'" className="min-h-[70px]" />
              </Field>
              <Field label="O que faria comprar agora?">
                <Input value={data.triggerCompra} onChange={set('triggerCompra')} placeholder="Ex: Desconto por tempo limitado + garantia de 7 dias" />
              </Field>
            </Section>

            {/* 3. Oferta */}
            <Section num={3} icon={TrendingUp} title="Oferta">
              <Row2>
                <Field label="Produto / Serviço">
                  <Input value={data.produto} onChange={set('produto')} placeholder="Nome do produto" />
                </Field>
                <Field label="Preço">
                  <Input value={data.preco} onChange={set('preco')} placeholder="Ex: R$ 997 ou 12x R$ 97" />
                </Field>
              </Row2>
              <Field label="Benefícios principais">
                <Textarea value={data.beneficios} onChange={set('beneficios')} placeholder="Ex: Aulas gravadas + mentorias ao vivo + comunidade + templates prontos" className="min-h-[70px]" />
              </Field>
              <Field label="Mecanismo único (por que funciona)">
                <Textarea value={data.mecanismo} onChange={set('mecanismo')} placeholder="Ex: Método P.A.C.E.: 4 etapas para campanhas lucrativas em qualquer nicho" className="min-h-[70px]" />
              </Field>
              <Row2>
                <Field label="Garantia / Bônus">
                  <Input value={data.garantia} onChange={set('garantia')} placeholder="Ex: 7 dias + bônus masterclass" />
                </Field>
                <Field label="Prazo de resultado">
                  <Input value={data.prazoResultado} onChange={set('prazoResultado')} placeholder="Ex: Primeiros resultados em 14 dias" />
                </Field>
              </Row2>
            </Section>

            {/* 4. Funil */}
            <Section num={4} icon={Target} title="Aquisição & Funil">
              <Row2>
                <Field label="Onde vende hoje?">
                  <Input value={data.ondeVende} onChange={set('ondeVende')} placeholder="Ex: Instagram, WhatsApp, Hotmart" />
                </Field>
                <Field label="Canais principais">
                  <Input value={data.canais} onChange={set('canais')} placeholder="Ex: Orgânico (Reels) + pago (Meta Ads)" />
                </Field>
              </Row2>
              <Field label="Como funciona o funil atual?">
                <Textarea value={data.funil} onChange={set('funil')} placeholder="Ex: Lead entra no grupo do WhatsApp → recebe sequência → CTA para página" className="min-h-[70px]" />
              </Field>
              <Field label="Objetivo principal do agente">
                <Select value={data.objetivo} onValueChange={setSelect('objetivo')}>
                  <SelectTrigger><SelectValue placeholder="— Selecione —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gerar lead qualificado">Gerar lead qualificado</SelectItem>
                    <SelectItem value="fechar venda diretamente">Fechar venda diretamente</SelectItem>
                    <SelectItem value="agendar uma call de vendas">Agendar call de vendas</SelectItem>
                    <SelectItem value="qualificar e direcionar ao time comercial">Qualificar e direcionar ao time</SelectItem>
                    <SelectItem value="nutrir e engajar o lead">Nutrir e engajar lead</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </Section>

            {/* 5. Comunicação */}
            <Section num={5} icon={MessageSquare} title="Comunicação & Tom">
              <Field label="Tom de voz">
                <Select value={data.tom} onValueChange={setSelect('tom')}>
                  <SelectTrigger><SelectValue placeholder="— Selecione —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="direto e energético (estilo Gary Vaynerchuk)">Direto e energético (Gary Vee)</SelectItem>
                    <SelectItem value="empático e inspirador (estilo Tony Robbins)">Empático e inspirador (Tony Robbins)</SelectItem>
                    <SelectItem value="técnico e educativo">Técnico e educativo</SelectItem>
                    <SelectItem value="descontraído com humor leve">Descontraído com humor leve</SelectItem>
                    <SelectItem value="agressivo e provocador">Agressivo e provocador</SelectItem>
                    <SelectItem value="sofisticado e premium">Sofisticado e premium</SelectItem>
                    <SelectItem value="amigável e consultivo">Amigável e consultivo</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Row2>
                <Field label="Pode usar gírias?">
                  <Select value={data.girias} onValueChange={setSelect('girias')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="não usar gírias">Não</SelectItem>
                      <SelectItem value="pode usar gírias com moderação">Sim, com moderação</SelectItem>
                      <SelectItem value="pode usar gírias livremente">Sim, livremente</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Pode usar humor?">
                  <Select value={data.humor} onValueChange={setSelect('humor')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sem humor">Não</SelectItem>
                      <SelectItem value="humor sutil e inteligente">Sim, sutil</SelectItem>
                      <SelectItem value="humor leve e descontraído">Sim, descontraído</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </Row2>
              <Field label="Referência de estilo (opcional)" hint="Ex: Coppolla Filmes, Joel Jota, Primo Rico...">
                <Input value={data.referencia} onChange={set('referencia')} placeholder="Quem seu agente deveria soar como?" />
              </Field>
            </Section>

            {/* 6. Provas */}
            <Section num={6} icon={Megaphone} title="Provas & Autoridade">
              <Field label="Resultados / números">
                <Textarea value={data.resultados} onChange={set('resultados')} placeholder="Ex: +500 alunos formados, média de 3x ROI em 30 dias, R$2M em vendas" className="min-h-[70px]" />
              </Field>
              <Field label="Tempo de mercado + diferenciais reais">
                <Input value={data.autoridade} onChange={set('autoridade')} placeholder="Ex: 7 anos de mercado, ex-gestor de tráfego da [Empresa X]" />
              </Field>
              <Field label="Exemplo de depoimento (resumo)">
                <Textarea value={data.depoimento} onChange={set('depoimento')} placeholder="Ex: 'Em 21 dias recuperei o investimento' — João, pet shop em SP" className="min-h-[60px]" />
              </Field>
            </Section>

            {/* 7. Regras */}
            <Section num={7} icon={Shield} title="Regras do Agente">
              <Field label="O que o agente DEVE fazer?">
                <Textarea value={data.devesFazer} onChange={set('devesFazer')} placeholder="Ex: Identificar o perfil, apresentar a oferta naturalmente, contornar objeções, guiar para o CTA" className="min-h-[70px]" />
              </Field>
              <Field label="O que NÃO pode fazer?">
                <Textarea value={data.naoFazer} onChange={set('naoFazer')} placeholder="Ex: Jamais oferecer desconto sem autorização, não prometer resultados garantidos" className="min-h-[70px]" />
              </Field>
              <Field label="CTA principal (para onde levar?)">
                <Input value={data.cta} onChange={set('cta')} placeholder="Ex: Link da página / número do WhatsApp / Calendly" />
              </Field>
              <Field label="Nome / identidade do agente (opcional)">
                <Input value={data.nomeAgente} onChange={set('nomeAgente')} placeholder="Ex: Kira — Especialista em tráfego da [Sua Empresa]" />
              </Field>
            </Section>

            {/* ── Generate button ────────────────────────────────────── */}
            <Button
              className="w-full h-14 text-base font-bold gap-2 bg-primary hover:bg-primary/90"
              onClick={generate}
              disabled={loading || progress < 40}
            >
              {loading ? (
                <><Loader2 className="h-5 w-5 animate-spin" /> Gerando prompt com IA...</>
              ) : (
                <><Zap className="h-5 w-5" /> Gerar Prompt Agora — {progress}% preenchido</>
              )}
            </Button>
            {progress < 40 && (
              <p className="text-xs text-center text-muted-foreground -mt-2">
                Preencha mais {40 - progress}% dos campos para liberar a geração
              </p>
            )}
          </div>

          {/* ── OUTPUT PANEL ──────────────────────────────────────────── */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start" ref={outputRef}>
            <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/40 bg-card/60">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full transition-colors ${loading ? 'bg-green-400 animate-pulse' : prompt ? 'bg-green-400' : 'bg-muted-foreground'}`} />
                  <span className="font-semibold text-sm">Prompt Gerado</span>
                  {isDemo && <Badge variant="outline" className="text-yellow-400 border-yellow-400/30 text-[10px]">Demo</Badge>}
                </div>
                {prompt && (
                  <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={copy}>
                    {copied ? <><Check className="h-3 w-3 text-green-400" /> Copiado!</> : <><Copy className="h-3 w-3" /> Copiar</>}
                  </Button>
                )}
              </div>

              <div className="min-h-[500px] max-h-[80vh] overflow-y-auto">
                {!prompt && !loading && (
                  <div className="flex flex-col items-center justify-center h-[400px] text-center px-8">
                    <Bot className="h-12 w-12 text-muted-foreground/30 mb-4" />
                    <p className="text-muted-foreground text-sm">Preencha o briefing ao lado e clique em <strong>Gerar Prompt</strong></p>
                    <p className="text-xs text-muted-foreground mt-2">Quanto mais detalhes, mais poderoso o prompt gerado</p>
                  </div>
                )}
                {loading && (
                  <div className="flex flex-col items-center justify-center h-[400px] gap-3">
                    <Loader2 className="h-8 w-8 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">Claude está criando seu agente de vendas...</p>
                    <p className="text-xs text-muted-foreground">Isso pode levar alguns segundos</p>
                  </div>
                )}
                {prompt && !loading && (
                  <pre className="p-5 text-sm leading-relaxed whitespace-pre-wrap text-foreground font-sans">
                    {prompt}
                  </pre>
                )}
              </div>
            </div>

            {/* Tip */}
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                <ChevronRight className="h-4 w-4 text-primary" /> Como usar o prompt
              </h4>
              <ul className="text-xs text-muted-foreground space-y-1.5">
                <li>📱 <strong>WhatsApp:</strong> Cole como prompt da Evolution API / ManyChat</li>
                <li>🤖 <strong>ChatGPT:</strong> Cole em "Custom Instructions" ou GPT personalizado</li>
                <li>💬 <strong>Claude:</strong> Use como System Prompt via API ou projeto</li>
                <li>⚙️ <strong>N8n / Make:</strong> Use como system message no nó de IA</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
