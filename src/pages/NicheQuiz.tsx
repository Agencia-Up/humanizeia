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
import { ArrowRight, ArrowLeft, Sparkles, CheckCircle2, Brain, Zap, Target, TrendingUp, Users } from 'lucide-react';

// ─── Questions ───────────────────────────────────────────────────────────────

const questions = [
  {
    id: 1,
    question: 'Qual é o nicho do seu negócio?',
    subtitle: 'Isso nos ajuda a personalizar todo o briefing e as estratégias dos agentes.',
    icon: Target,
    options: [
      { id: 'automotivo', label: 'Automotivo', desc: 'Concessionárias, Lojas de Carros, Oficinas', emoji: '🚗' },
      { id: 'saude_bem_estar', label: 'Saúde e Bem-Estar', desc: 'Clínicas, Consultórios, Spas, Academias', emoji: '💊' },
      { id: 'varejo_ecommerce', label: 'Varejo e E-commerce', desc: 'Moda, Acessórios, Produtos Físicos', emoji: '🛍️' },
      { id: 'educacao_conhecimento', label: 'Educação e Conhecimento', desc: 'Cursos Online, Infoprodutos, Consultorias', emoji: '🎓' },
      { id: 'alimentacao_bebidas', label: 'Alimentação e Bebidas', desc: 'Restaurantes, Bares, Cafeterias', emoji: '🍽️' },
      { id: 'imobiliario', label: 'Imobiliário', desc: 'Imobiliárias, Corretores, Construtoras', emoji: '🏠' },
      { id: 'servicos_b2b', label: 'Serviços B2B', desc: 'Consultoria, Agências, TI Empresarial', emoji: '💼' },
      { id: 'pet', label: 'Pet', desc: 'Pet Shops, Clínicas Veterinárias, Banho e Tosa', emoji: '🐾' },
      { id: 'financas_investimentos', label: 'Finanças e Investimentos', desc: 'Seguradoras, Consultores, Bancos', emoji: '💰' },
      { id: 'tecnologia_saas', label: 'Tecnologia e SaaS', desc: 'Software, Apps, Startups', emoji: '💻' },
      { id: 'outro', label: 'Outro', desc: 'Especifique abaixo', emoji: '✨', hasInput: true },
    ],
  },
  {
    id: 2,
    question: 'Qual é o seu principal objetivo de marketing?',
    subtitle: 'Os agentes irão priorizar sua estratégia com base nessa resposta.',
    icon: TrendingUp,
    options: [
      { id: 'gerar_leads', label: 'Gerar Leads Qualificados', desc: 'Test drive, consulta, visita, orçamento', emoji: '🎯' },
      { id: 'vendas_diretas', label: 'Aumentar Vendas Diretas', desc: 'E-commerce, reservas, conversão direta', emoji: '💳' },
      { id: 'reconhecimento', label: 'Reconhecimento de Marca', desc: 'Engajamento e awareness nas redes sociais', emoji: '📣' },
      { id: 'lancamento', label: 'Lançar Produto ou Serviço', desc: 'Expansão para novo mercado ou produto', emoji: '🚀' },
      { id: 'fidelizacao', label: 'Fidelizar Clientes', desc: 'Aumentar LTV e retenção', emoji: '🔄' },
    ],
  },
  {
    id: 3,
    question: 'Qual é o tamanho do seu negócio?',
    subtitle: 'Vamos calibrar as estratégias para a sua realidade atual.',
    icon: Users,
    options: [
      { id: 'solopreneur', label: 'Empreendedor Solo', desc: 'Só eu, sem equipe', emoji: '👤' },
      { id: 'micro', label: 'Micro Empresa', desc: '2 a 9 funcionários', emoji: '🏪' },
      { id: 'pequena', label: 'Pequena Empresa', desc: '10 a 49 funcionários', emoji: '🏢' },
      { id: 'media', label: 'Média Empresa', desc: '50+ funcionários', emoji: '🏗️' },
      { id: 'agencia', label: 'Agência de Marketing', desc: 'Gerencio clientes de terceiros', emoji: '💡' },
    ],
  },
  {
    id: 4,
    question: 'Qual é o seu nível de experiência com marketing digital?',
    subtitle: 'Os agentes adaptam a linguagem e nível de detalhe com base nisso.',
    icon: Brain,
    options: [
      { id: 'iniciante', label: 'Iniciante', desc: 'Estou começando agora, pouca experiência', emoji: '🌱' },
      { id: 'intermediario', label: 'Intermediário', desc: 'Já fiz campanhas, tenho alguma experiência', emoji: '📈' },
      { id: 'avancado', label: 'Avançado', desc: 'Gestão de campanhas no dia a dia', emoji: '⚡' },
      { id: 'especialista', label: 'Especialista', desc: 'Profissional de marketing ou gestor de tráfego', emoji: '🏆' },
    ],
  },
];

// ─── Loading Screen Component ─────────────────────────────────────────────────

const LOADING_STEPS = [
  { icon: Brain, label: 'Analisando seu perfil de nicho...', color: 'text-blue-400' },
  { icon: Zap, label: 'Calibrando os agentes de IA...', color: 'text-yellow-400' },
  { icon: Target, label: 'Personalizando o briefing estratégico...', color: 'text-purple-400' },
  { icon: Sparkles, label: 'Montando sua estratégia exclusiva...', color: 'text-pink-400' },
  { icon: CheckCircle2, label: 'Tudo pronto! Redirecionando...', color: 'text-emerald-400' },
];

function LoadingScreen() {
  const [step, setStep] = useState(0);
  const [subStep, setSubStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStep(prev => {
        if (prev < LOADING_STEPS.length - 1) return prev + 1;
        clearInterval(interval);
        return prev;
      });
    }, 900);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setSubStep(prev => (prev + 1) % 3);
    }, 400);
    return () => clearInterval(interval);
  }, []);

  const dots = '.'.repeat(subStep + 1);

  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center z-50 overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-pink-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '0.5s' }} />
      </div>

      {/* Orbital rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[500px] h-[500px] rounded-full border border-purple-500/10 animate-spin" style={{ animationDuration: '20s' }} />
        <div className="absolute w-[350px] h-[350px] rounded-full border border-blue-500/10 animate-spin" style={{ animationDuration: '15s', animationDirection: 'reverse' }} />
        <div className="absolute w-[200px] h-[200px] rounded-full border border-pink-500/10 animate-spin" style={{ animationDuration: '10s' }} />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-10 px-8 text-center max-w-lg">
        {/* Central icon */}
        <div className="relative">
          <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-purple-600/20 to-blue-600/20 border border-purple-500/30 flex items-center justify-center backdrop-blur-sm shadow-2xl shadow-purple-500/20">
            <Sparkles className="h-12 w-12 text-purple-400 animate-pulse" />
          </div>
          {/* Orbiting dots */}
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="absolute w-3 h-3 rounded-full bg-gradient-to-r from-purple-400 to-blue-400"
              style={{
                top: '50%',
                left: '50%',
                transform: `rotate(${i * 120}deg) translateX(52px) translateY(-50%)`,
                animation: `spin ${3 + i * 0.5}s linear infinite`,
                boxShadow: '0 0 8px rgba(168, 85, 247, 0.6)',
              }}
            />
          ))}
        </div>

        {/* Main text */}
        <div className="space-y-3">
          <h2 className="text-2xl font-bold text-foreground">
            Trabalhando para turbinar
            <br />
            <span className="bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              a sua estratégia{dots}
            </span>
          </h2>
          <p className="text-muted-foreground text-sm">
            Nossa equipe de IA está personalizando todos os agentes com base no seu perfil de negócio.
          </p>
        </div>

        {/* Steps */}
        <div className="w-full space-y-3">
          {LOADING_STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === step;
            const isDone = i < step;

            return (
              <div
                key={i}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-500 ${
                  isActive
                    ? 'border-purple-500/40 bg-purple-500/10 scale-[1.02]'
                    : isDone
                    ? 'border-emerald-500/20 bg-emerald-500/5'
                    : 'border-border/30 bg-muted/5 opacity-40'
                }`}
              >
                <div className={`shrink-0 ${isActive ? s.color : isDone ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                  {isDone ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Icon className={`h-4 w-4 ${isActive ? 'animate-pulse' : ''}`} />
                  )}
                </div>
                <span className={`text-sm text-left ${isActive ? 'text-foreground font-medium' : isDone ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                  {s.label}
                </span>
                {isActive && (
                  <div className="ml-auto flex gap-1">
                    {[0, 1, 2].map((d) => (
                      <div
                        key={d}
                        className="w-1.5 h-1.5 rounded-full bg-purple-400"
                        style={{ animation: `bounce 0.6s ease-in-out ${d * 0.15}s infinite` }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        <div className="w-full space-y-2">
          <Progress
            value={((step + 1) / LOADING_STEPS.length) * 100}
            className="h-1.5 bg-muted/30"
          />
          <p className="text-xs text-muted-foreground">
            {Math.round(((step + 1) / LOADING_STEPS.length) * 100)}% concluído
          </p>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
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
  const Icon = currentQuestion.icon;

  const handleNext = () => {
    if (!answers[currentQuestion.id]) {
      toast({ title: 'Selecione uma opção', description: 'Por favor, escolha uma resposta para continuar.', variant: 'destructive' });
      return;
    }
    if (selectedOption?.hasInput && !otherInputs[currentQuestion.id]?.trim()) {
      toast({ title: 'Campo obrigatório', description: 'Por favor, especifique sua resposta.', variant: 'destructive' });
      return;
    }
    if (currentStep < questions.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    if (!user) {
      navigate('/auth');
      return;
    }

    const identifiedNiche = answers[1];
    if (!identifiedNiche) {
      toast({ title: 'Erro', description: 'Nicho não identificado.', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    setShowLoading(true);

    try {
      const respostasCompletas = { answers, otherInputs };

      // Check if already has a response
      const { data: existing } = await supabase
        .from('user_quiz_responses' as any)
        .select('id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);

      const existingId = (existing as any)?.[0]?.id;

      const upsertPayload = {
        user_id: user.id,
        nicho_identificado: identifiedNiche,
        respostas_completas: respostasCompletas,
        updated_at: new Date().toISOString(),
      };

      if (existingId) {
        await supabase.from('user_quiz_responses' as any).update(upsertPayload).eq('id', existingId);
      } else {
        await supabase.from('user_quiz_responses' as any).insert(upsertPayload);
      }

      // Mark quiz as completed
      await supabase.from('profiles').update({ quiz_completed: true }).eq('id', user.id);

      // Wait for the loading animation to complete (at least 4.5s)
      await new Promise(resolve => setTimeout(resolve, 4800));

      navigate(`/briefing/${identifiedNiche}`, { replace: true });
    } catch (err: any) {
      setShowLoading(false);
      setIsSubmitting(false);
      toast({ title: 'Erro ao salvar', description: err.message, variant: 'destructive' });
    }
  };

  if (showLoading) return <LoadingScreen />;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 sm:p-8 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-to-b from-primary/8 to-transparent rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-2xl space-y-8">

        {/* Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-600/20 border border-primary/30 shadow-lg shadow-primary/10">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">
              Vamos personalizar sua <span className="bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">experiência</span>
            </h1>
            <p className="text-muted-foreground text-sm max-w-md mx-auto leading-relaxed">
              Responda 4 perguntas rápidas para que nossos agentes de IA trabalhem com máxima precisão para o seu negócio.
            </p>
          </div>
        </div>

        {/* Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground font-medium">
              Pergunta <span className="text-foreground font-bold">{currentStep + 1}</span> de {questions.length}
            </span>
            <span className="text-primary font-bold">{Math.round(progress)}% concluído</span>
          </div>
          <div className="relative h-2 bg-muted/40 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary to-purple-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          {/* Step dots */}
          <div className="flex justify-center gap-2 pt-1">
            {questions.map((_, i) => (
              <div
                key={i}
                className={`rounded-full transition-all duration-300 ${
                  i < currentStep ? 'w-6 h-1.5 bg-primary' : i === currentStep ? 'w-4 h-1.5 bg-primary' : 'w-1.5 h-1.5 bg-muted-foreground/30'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Question card */}
        <div className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-xl overflow-hidden">
          {/* Question header */}
          <div className="px-6 pt-6 pb-4 border-b border-border/30 bg-gradient-to-r from-primary/5 to-transparent">
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mt-0.5">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground leading-tight">
                  {currentQuestion.question}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">{currentQuestion.subtitle}</p>
              </div>
            </div>
          </div>

          {/* Options */}
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
                          ? 'border-primary bg-primary/8 ring-1 ring-primary shadow-sm shadow-primary/10'
                          : 'border-border/40 bg-background/50 hover:border-border hover:bg-muted/30'
                      }`}
                    >
                      <RadioGroupItem
                        value={option.id}
                        id={`q${currentQuestion.id}-${option.id}`}
                        className="shrink-0"
                      />
                      <span className="text-xl shrink-0">{option.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm font-semibold ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                          {option.label}
                        </span>
                        <p className="text-xs text-muted-foreground mt-0.5">{option.desc}</p>
                      </div>
                      {isSelected && (
                        <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                      )}
                    </Label>
                    {option.hasInput && isSelected && (
                      <Input
                        placeholder="Descreva seu nicho brevemente..."
                        value={otherInputs[currentQuestion.id] || ''}
                        onChange={(e) => setOtherInputs(prev => ({ ...prev, [currentQuestion.id]: e.target.value }))}
                        className="ml-4 focus-visible:ring-primary/50"
                        autoFocus
                      />
                    )}
                  </div>
                );
              })}
            </RadioGroup>
          </div>

          {/* Navigation */}
          <div className="px-6 pb-6 flex items-center justify-between gap-4">
            <Button
              variant="ghost"
              onClick={() => setCurrentStep(prev => prev - 1)}
              disabled={currentStep === 0 || isSubmitting}
              className="gap-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Anterior
            </Button>
            <Button
              onClick={handleNext}
              disabled={isSubmitting || !answers[currentQuestion.id]}
              className="gap-2 bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 text-white font-semibold shadow-lg shadow-primary/20 min-w-[140px]"
            >
              {currentStep === questions.length - 1 ? (
                <>
                  <Sparkles className="h-4 w-4" />
                  Concluir Quiz
                </>
              ) : (
                <>
                  Próxima
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          🔒 Suas respostas são confidenciais e usadas apenas para personalizar seus agentes de IA.
        </p>
      </div>
    </div>
  );
}
