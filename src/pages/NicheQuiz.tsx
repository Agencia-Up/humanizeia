import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import {
  ArrowRight, ArrowLeft, Sparkles, CheckCircle2,
  Brain, Zap, Target, Cpu, BarChart3
} from 'lucide-react';

// ─── Quiz Questions ───────────────────────────────────────────────────────────

const questions = [
  {
    id: 1,
    question: 'Quais nichos focamos para criação do briefing?',
    options: [
      { id: 'automotivo',             label: 'Automotivo (Concessionárias, Lojas de Carros, Oficinas)',                   emoji: '🚗' },
      { id: 'saude_bem_estar',        label: 'Saúde e Bem-Estar (Clínicas, Consultórios, Spas, Academias)',                emoji: '💊' },
      { id: 'varejo_ecommerce',       label: 'Varejo e E-commerce (Moda, Acessórios, Produtos Físicos)',                   emoji: '🛍️' },
      { id: 'educacao_conhecimento',  label: 'Educação e Conhecimento (Cursos Online, Infoprodutos, Consultorias)',         emoji: '🎓' },
      { id: 'alimentacao_bebidas',    label: 'Alimentação e Bebidas (Restaurantes, Bares, Cafeterias)',                    emoji: '🍽️' },
      { id: 'imobiliario',            label: 'Imobiliário (Imobiliárias, Corretores, Construtoras)',                       emoji: '🏠' },
      { id: 'servicos_b2b',           label: 'Serviços Profissionais B2B (Consultoria, Agências, TI)',                    emoji: '💼' },
      { id: 'pet',                    label: 'Pet (Pet Shops, Clínicas Veterinárias, Serviços para Animais)',              emoji: '🐾' },
      { id: 'financas_investimentos', label: 'Finanças e Investimentos (Bancos, Seguradoras, Consultores Financeiros)',    emoji: '💰' },
      { id: 'tecnologia_saas',        label: 'Tecnologia e Software (SaaS, Apps, Startups)',                              emoji: '💻' },
      { id: 'outro',                  label: 'Outro (Por favor, especifique brevemente)',                                  emoji: '✨', hasInput: true },
    ],
  },
  {
    id: 2,
    question: 'Qual é o principal produto ou serviço que você oferece?',
    options: [
      { id: 'a', label: 'Venda de veículos (novos/usados), serviços automotivos',                                         emoji: '🚘' },
      { id: 'b', label: 'Tratamentos estéticos, serviços de beleza, consultas médicas/odontológicas, planos de academia', emoji: '✨' },
      { id: 'c', label: 'Roupas, joias, acessórios, produtos de moda',                                                   emoji: '👗' },
      { id: 'd', label: 'Cursos digitais, e-books, mentorias, softwares',                                                 emoji: '📚' },
      { id: 'e', label: 'Refeições, bebidas, experiências gastronômicas',                                                 emoji: '🍴' },
      { id: 'f', label: 'Venda/aluguel de imóveis, consultoria imobiliária',                                              emoji: '🏡' },
      { id: 'g', label: 'Consultoria estratégica, serviços de TI, soluções empresariais',                                 emoji: '💡' },
      { id: 'h', label: 'Produtos para pets, serviços veterinários, banho e tosa',                                        emoji: '🐶' },
      { id: 'i', label: 'Investimentos, seguros, consultoria financeira',                                                  emoji: '📊' },
      { id: 'j', label: 'Softwares, aplicativos, serviços de tecnologia',                                                 emoji: '🖥️' },
      { id: 'k', label: 'Outro (Por favor, especifique brevemente)',                                                      emoji: '📌', hasInput: true },
    ],
  },
  {
    id: 3,
    question: 'Qual é o seu principal objetivo de marketing no momento?',
    options: [
      { id: 'a', label: 'Gerar leads qualificados para vendas (ex: test drive, consulta, visita)', emoji: '🎯' },
      { id: 'b', label: 'Aumentar o reconhecimento da marca e engajamento nas redes sociais',       emoji: '📣' },
      { id: 'c', label: 'Impulsionar vendas diretas (e-commerce, reservas)',                       emoji: '💳' },
      { id: 'd', label: 'Lançar um novo produto/serviço ou expandir para um novo mercado',          emoji: '🚀' },
      { id: 'e', label: 'Fidelizar clientes e aumentar o valor de vida útil (LTV)',                emoji: '🔄' },
    ],
  },
  {
    id: 4,
    question: 'Você já possui uma conta de Instagram Business ou Criador vinculada a uma Página do Facebook?',
    options: [
      { id: 'a', label: 'Sim, já está configurada e vinculada.',             emoji: '✅' },
      { id: 'b', label: 'Não, mas tenho uma conta pessoal e quero migrar.',  emoji: '🔄' },
      { id: 'c', label: 'Não, e preciso de ajuda para configurar.',          emoji: '⚙️' },
      { id: 'd', label: 'Não tenho Instagram.',                              emoji: '❌' },
    ],
  },
];

const NICHE_LABELS: Record<string, string> = {
  automotivo: 'Automotivo',
  saude_bem_estar: 'Saúde e Bem-Estar',
  varejo_ecommerce: 'Varejo e E-commerce',
  educacao_conhecimento: 'Educação e Conhecimento',
  alimentacao_bebidas: 'Alimentação e Bebidas',
  imobiliario: 'Imobiliário',
  servicos_b2b: 'Serviços B2B',
  pet: 'Pet',
  financas_investimentos: 'Finanças e Investimentos',
  tecnologia_saas: 'Tecnologia e SaaS',
  outro: 'Personalizado',
};

// ─── Loading Screen ───────────────────────────────────────────────────────────

const LOADING_STEPS = [
  { icon: Brain,        label: 'Analisando seu nicho de mercado...',            color: 'text-blue-400'   },
  { icon: Cpu,          label: 'Carregando base de conhecimento estratégico...', color: 'text-purple-400' },
  { icon: Zap,          label: 'Agente de briefing está trabalhando...',        color: 'text-yellow-400' },
  { icon: Target,       label: 'Personalizando perguntas para o seu nicho...',  color: 'text-pink-400'   },
  { icon: BarChart3,    label: 'Montando sua estratégia exclusiva...',          color: 'text-cyan-400'   },
  { icon: CheckCircle2, label: 'Pronto! Direcionando para o Salomão...',        color: 'text-emerald-400' },
];

function LoadingScreen({ niche }: { niche: string }) {
  const [step, setStep] = useState(0);
  const [dots, setDots] = useState('.');

  useEffect(() => {
    const iv = setInterval(() => {
      setStep(prev => (prev < LOADING_STEPS.length - 1 ? prev + 1 : prev));
    }, 850);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => setDots(d => d.length >= 3 ? '.' : d + '.'), 380);
    return () => clearInterval(iv);
  }, []);

  const nicheName = NICHE_LABELS[niche] || 'seu nicho';

  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center z-50 overflow-hidden">
      {/* Animated blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/8  rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/8   rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2  left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-pink-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '0.5s' }} />
      </div>

      {/* Orbit rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[480px] h-[480px] rounded-full border border-purple-500/10 animate-spin" style={{ animationDuration: '22s' }} />
        <div className="absolute w-[330px] h-[330px] rounded-full border border-blue-500/10 animate-spin" style={{ animationDuration: '16s', animationDirection: 'reverse' }} />
        <div className="absolute w-[190px] h-[190px] rounded-full border border-pink-500/10 animate-spin" style={{ animationDuration: '10s' }} />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-8 px-6 text-center max-w-md w-full">
        {/* Icon */}
        <div className="relative">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-600/20 to-blue-600/20 border border-purple-500/30 flex items-center justify-center backdrop-blur-sm shadow-2xl shadow-purple-500/20">
            <Sparkles className="h-10 w-10 text-purple-400 animate-pulse" />
          </div>
          {[0, 1, 2].map(i => (
            <div key={i} className="absolute w-2.5 h-2.5 rounded-full bg-gradient-to-r from-purple-400 to-blue-400"
              style={{
                top: '50%', left: '50%',
                transform: `rotate(${i * 120}deg) translateX(48px) translateY(-50%)`,
                animation: `spin ${3 + i * 0.4}s linear infinite`,
                boxShadow: '0 0 8px rgba(168,85,247,0.6)',
              }}
            />
          ))}
        </div>

        {/* Title */}
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">
            Trabalhando para turbinar
            <br />
            <span className="bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              a sua estratégia{dots}
            </span>
          </h2>
          <p className="text-muted-foreground text-sm">
            O agente de briefing está preparando tudo para o nicho de{' '}
            <span className="text-primary font-semibold">{nicheName}</span>.
          </p>
        </div>

        {/* Steps */}
        <div className="w-full space-y-2">
          {LOADING_STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === step;
            const isDone = i < step;
            return (
              <div key={i} className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all duration-500 ${
                isActive ? 'border-purple-500/40 bg-purple-500/10 scale-[1.02]'
                : isDone  ? 'border-emerald-500/20 bg-emerald-500/5'
                : 'border-border/20 bg-muted/5 opacity-30'
              }`}>
                <div className={`shrink-0 ${isActive ? s.color : isDone ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                  {isDone
                    ? <CheckCircle2 className="h-4 w-4" />
                    : <Icon className={`h-4 w-4 ${isActive ? 'animate-pulse' : ''}`} />
                  }
                </div>
                <span className={`text-sm text-left flex-1 ${isActive ? 'text-foreground font-medium' : isDone ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                  {s.label}
                </span>
                {isActive && (
                  <div className="flex gap-1">
                    {[0, 1, 2].map(d => (
                      <div key={d} className="w-1.5 h-1.5 rounded-full bg-purple-400"
                        style={{ animation: `bounce 0.6s ease-in-out ${d * 0.15}s infinite` }} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        <div className="w-full space-y-1.5">
          <Progress value={((step + 1) / LOADING_STEPS.length) * 100} className="h-1.5 bg-muted/30" />
          <p className="text-xs text-muted-foreground">
            {Math.round(((step + 1) / LOADING_STEPS.length) * 100)}% concluído
          </p>
        </div>
      </div>

      <style>{`
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
      `}</style>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NicheQuiz() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [otherInputs, setOtherInputs] = useState<Record<number, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showLoading, setShowLoading] = useState(false);


  const progress = ((currentStep + 1) / questions.length) * 100;
  const currentQuestion = questions[currentStep];
  const selectedOption = currentQuestion.options.find(o => o.id === answers[currentQuestion.id]);

  const handleNext = () => {
    if (!answers[currentQuestion.id]) {
      toast({ title: 'Selecione uma opção', description: 'Por favor, escolha uma resposta para continuar.', variant: 'destructive' });
      return;
    }
    if ((selectedOption as any)?.hasInput && !otherInputs[currentQuestion.id]?.trim()) {
      toast({ title: 'Campo obrigatório', description: 'Por favor, especifique a opção escolhida.', variant: 'destructive' });
      return;
    }
    if (currentStep < questions.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    if (!user) { navigate('/auth'); return; }

    const identifiedNiche = answers[1];
    if (!identifiedNiche) return;

    setIsSubmitting(true);
    setShowLoading(true);

    // ── Salvar no localStorage imediatamente (fallback garantido) ──
    localStorage.setItem(`quiz_completed_${user.id}`, 'true');
    localStorage.setItem(`quiz_niche_${user.id}`, identifiedNiche);

    try {
      // 1. Tenta salvar no banco (ignora se tabela não existe)
      try {
        await supabase.from('user_quiz_responses' as any).insert({
          user_id: user.id,
          nicho_identificado: identifiedNiche,
          respostas_completas: { answers, otherInputs },
        });
      } catch { /* tabela pode não existir ainda */ }

      // 2. Tenta marcar quiz_completed no perfil (ignora se coluna não existe)
      try {
        await supabase.from('profiles').update({ quiz_completed: true } as any).eq('id', user.id);
      } catch { /* coluna pode não existir ainda */ }

      // 3. Busca template do nicho
      let templateContent = '';
      try {
        const resp = await fetch(`/briefings/briefing_nicho_${identifiedNiche}.md`);
        if (resp.ok) templateContent = await resp.text();
      } catch { /* arquivo não encontrado */ }

      // 4. Gera briefing via IA (ignora se edge function falhar)
      const quizSummary = [
        `Nicho: ${NICHE_LABELS[identifiedNiche] || identifiedNiche}`,
        `Produto/Serviço: ${questions[1].options.find(o => o.id === answers[2])?.label || 'Não informado'}`,
        `Objetivo: ${questions[2].options.find(o => o.id === answers[3])?.label || 'Não informado'}`,
        `Presença Digital: ${questions[3].options.find(o => o.id === answers[4])?.label || 'Não informado'}`,
        otherInputs[1] ? `Detalhe: ${otherInputs[1]}` : '',
      ].filter(Boolean).join('\n');

      let generatedBriefing = '';
      try {
        const res = await supabase.functions.invoke('claude-chat', {
          body: {
            context: 'assistant',
            stream: false,
            messages: [{
              role: 'user',
              content: `Você é o Agente de Briefing do Salomão.\n\nCom base nas respostas do quiz e no template, gere um BRIEFING ESTRATÉGICO COMPLETO e PRÉ-PREENCHIDO.\n\nQUIZ:\n${quizSummary}\n\nTEMPLATE:\n${templateContent || `Nicho: ${NICHE_LABELS[identifiedNiche]}\nGere briefing com: Negócio & Marca, Cliente Ideal, Oferta, Aquisição, Comunicação, Autoridade, Regras do Agente.`}\n\nGere o briefing completo em português brasileiro.`,
            }],
          },
        });
        const content = res.data?.choices?.[0]?.message?.content || res.data?.content;
        if (content) generatedBriefing = content;
      } catch { /* edge function pode falhar */ }

      if (!generatedBriefing && templateContent) {
        generatedBriefing = `# Briefing — ${NICHE_LABELS[identifiedNiche] || identifiedNiche}\n\n${templateContent}`;
      }

      // 5. Salva briefing no histórico do Salomão (ignora se tabela não existe)
      if (generatedBriefing) {
        try {
          await supabase.from('agent_chat_history' as any).insert({
            user_id: user.id,
            agent_id: 'salomao',
            role: 'assistant',
            content: generatedBriefing,
            metadata: { type: 'generated_prompt', source: 'quiz', niche: identifiedNiche },
          });
        } catch { /* tabela pode não existir ainda */ }

        // 6. NOVO: Sincroniza com a tabela de briefing global (Source of Truth)
        try {
          const productLabel = questions[1].options.find(o => o.id === answers[2])?.label || '';
          const objectiveLabel = questions[2].options.find(o => o.id === answers[3])?.label || '';
          
          await supabase.from('client_briefings' as any).upsert({
            user_id: user.id,
            business_name: NICHE_LABELS[identifiedNiche] || identifiedNiche,
            product_service: productLabel,
            target_audience: 'Empresário do Nicho ' + (NICHE_LABELS[identifiedNiche] || identifiedNiche),
            main_offer: objectiveLabel,
            differentiators: otherInputs[1] || 'Não especificado',
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id' });
        } catch (e) { 
          console.error('Erro ao sincronizar briefing global:', e);
        }
      }

      // 7. Aguarda animação e redireciona — navigate() mantém a sessão ativa
      await new Promise(resolve => setTimeout(resolve, 5200));
      navigate('/salomao', { replace: true });


    } catch (err: any) {
      setShowLoading(false);
      setIsSubmitting(false);
      toast({ title: 'Erro inesperado', description: err.message || 'Tente novamente.', variant: 'destructive' });
    }
  };

  if (showLoading) return <LoadingScreen niche={answers[1] || 'outro'} />;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 sm:p-8 relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-gradient-to-b from-primary/6 to-transparent rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-2xl space-y-8">

        {/* Header */}
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-purple-600/20 border border-primary/30 shadow-lg shadow-primary/10">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Quiz de Qualificação de Nicho</h1>
            <p className="max-w-md text-muted-foreground leading-relaxed">
              Oi! Para que a LogosIA possa otimizar sua estratégia de marketing com a máxima precisão,
              precisamos entender um pouco mais sobre o seu negócio.
            </p>
          </div>
        </div>

        {/* Progress */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm font-medium">
            <span className="text-muted-foreground">
              Pergunta <span className="text-foreground font-bold">{currentStep + 1}</span> de {questions.length}
            </span>
            <span className="text-primary font-bold">{Math.round(progress)}% completo</span>
          </div>
          <div className="relative h-2 rounded-full bg-muted/40 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-purple-500 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Question card */}
        <div className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-xl overflow-hidden">
          <div className="px-6 pt-6 pb-4 border-b border-border/30">
            <h2 className="text-xl font-bold leading-tight">
              {currentQuestion.id}. {currentQuestion.question}
            </h2>
          </div>

          <div className="p-6">
            <RadioGroup
              value={answers[currentQuestion.id]}
              onValueChange={(val) => setAnswers(prev => ({ ...prev, [currentQuestion.id]: val }))}
              className="space-y-2"
            >
              {currentQuestion.options.map((option) => {
                const isSelected = answers[currentQuestion.id] === option.id;
                return (
                  <div key={option.id} className="flex flex-col gap-2">
                    <Label
                      htmlFor={`q${currentQuestion.id}-${option.id}`}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-all duration-200 ${
                        isSelected
                          ? 'border-primary bg-primary/8 ring-1 ring-primary shadow-sm'
                          : 'border-border/40 bg-background/50 hover:border-border hover:bg-muted/30'
                      }`}
                    >
                      <RadioGroupItem value={option.id} id={`q${currentQuestion.id}-${option.id}`} className="shrink-0" />
                      <span className="text-lg shrink-0">{(option as any).emoji || '•'}</span>
                      <span className={`flex-1 text-sm font-medium ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                        {option.label}
                      </span>
                      {isSelected && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                    </Label>

                    {(option as any).hasInput && isSelected && (
                      <Input
                        placeholder="Especifique aqui..."
                        value={otherInputs[currentQuestion.id] || ''}
                        onChange={(e) => setOtherInputs(prev => ({ ...prev, [currentQuestion.id]: e.target.value }))}
                        className="ml-9 focus-visible:ring-primary/50"
                        autoFocus
                      />
                    )}
                  </div>
                );
              })}
            </RadioGroup>
          </div>

          <div className="px-6 pb-6 flex items-center justify-between gap-4">
            <Button
              variant="ghost"
              onClick={() => setCurrentStep(prev => prev - 1)}
              disabled={currentStep === 0 || isSubmitting}
              className="gap-2 text-muted-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Anterior
            </Button>
            <Button
              onClick={handleNext}
              disabled={isSubmitting || !answers[currentQuestion.id]}
              className="gap-2 min-w-[140px] bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 text-white font-semibold shadow-lg shadow-primary/20"
            >
              {currentStep === questions.length - 1
                ? <><Sparkles className="h-4 w-4" /> Concluir</>
                : <>Próxima <ArrowRight className="h-4 w-4" /></>
              }
            </Button>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground px-4">
          Suas respostas nos ajudarão a direcionar você para o briefing mais adequado e a personalizar
          a atuação dos nossos Agentes de IA.
        </p>
      </div>
    </div>
  );
}
