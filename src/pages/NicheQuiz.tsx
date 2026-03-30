import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Sparkles, ArrowRight, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

const questions = [
  {
    id: 1,
    question: "Qual é o principal setor de atuação do seu negócio?",
    options: [
      { id: 'automotivo', label: "Automotivo (Concessionárias, Lojas de Carros, Oficinas)" },
      { id: 'saude_bem_estar', label: "Saúde e Bem-Estar (Clínicas, Consultórios, Spas, Academias)" },
      { id: 'varejo_ecommerce', label: "Varejo e E-commerce (Moda, Acessórios, Produtos Físicos)" },
      { id: 'educacao_conhecimento', label: "Educação e Conhecimento (Cursos Online, Infoprodutos, Consultorias)" },
      { id: 'alimentacao_bebidas', label: "Alimentação e Bebidas (Restaurantes, Bares, Cafeterias)" },
      { id: 'imobiliario', label: "Imobiliário (Imobiliárias, Corretores, Construtoras)" },
      { id: 'servicos_b2b', label: "Serviços Profissionais B2B (Consultoria, Agências, TI)" },
      { id: 'pet', label: "Pet (Pet Shops, Clínicas Veterinárias, Serviços para Animais)" },
      { id: 'financas_investimentos', label: "Finanças e Investimentos (Bancos, Seguradoras, Consultores Financeiros)" },
      { id: 'tecnologia_saas', label: "Tecnologia e Software (SaaS, Apps, Startups)" },
      { id: 'outro', label: "Outro (Por favor, especifique brevemente)", hasInput: true }
    ]
  },
  {
    id: 2,
    question: "Qual é o principal produto ou serviço que você oferece?",
    options: [
      { id: 'a', label: "Venda de veículos (novos/usados), serviços automotivos" },
      { id: 'b', label: "Tratamentos estéticos, serviços de beleza, consultas médicas/odontológicas, planos de academia" },
      { id: 'c', label: "Roupas, joias, acessórios, produtos de moda" },
      { id: 'd', label: "Cursos digitais, e-books, mentorias, softwares" },
      { id: 'e', label: "Refeições, bebidas, experiências gastronômicas" },
      { id: 'f', label: "Venda/aluguel de imóveis, consultoria imobiliária" },
      { id: 'g', label: "Consultoria estratégica, serviços de TI, soluções empresariais" },
      { id: 'h', label: "Produtos para pets, serviços veterinários, banho e tosa" },
      { id: 'i', label: "Investimentos, seguros, consultoria financeira" },
      { id: 'j', label: "Softwares, aplicativos, serviços de tecnologia" },
      { id: 'k', label: "Outro (Por favor, especifique brevemente)", hasInput: true }
    ]
  },
  {
    id: 3,
    question: "Qual é o seu principal objetivo de marketing no momento?",
    options: [
      { id: 'a', label: "Gerar leads qualificados para vendas (ex: test drive, consulta, visita)" },
      { id: 'b', label: "Aumentar o reconhecimento da marca e engajamento nas redes sociais" },
      { id: 'c', label: "Impulsionar vendas diretas (e-commerce, reservas)" },
      { id: 'd', label: "Lançar um novo produto/serviço ou expandir para um novo mercado" },
      { id: 'e', label: "Fidelizar clientes e aumentar o valor de vida útil (LTV)" }
    ]
  },
  {
    id: 4,
    question: "Você já possui uma conta de Instagram Business ou Criador vinculada a uma Página do Facebook?",
    options: [
      { id: 'a', label: "Sim, já está configurada e vinculada." },
      { id: 'b', label: "Não, mas tenho uma conta pessoal e quero migrar." },
      { id: 'c', label: "Não, e preciso de ajuda para configurar." },
      { id: 'd', label: "Não tenho Instagram." }
    ]
  }
];

export default function NicheQuiz() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [otherInputs, setOtherInputs] = useState<Record<number, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUserId(session.user.id);
      } else {
        navigate('/auth');
      }
    };
    getSession();
  }, [navigate]);

  const progress = ((currentStep + 1) / questions.length) * 100;
  const currentQuestion = questions[currentStep];

  const handleNext = () => {
    if (!answers[currentQuestion.id]) {
      toast({
        title: "Seleção obrigatória",
        description: "Por favor, selecione uma opção para continuar.",
        variant: "destructive"
      });
      return;
    }

    if (currentStep < questions.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleSubmit();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleSubmit = async () => {
    if (!userId) return;
    
    setIsSubmitting(true);
    const identifiedNiche = answers[1]; // The first question identifies the niche
    
    try {
      const { error } = await supabase
        .from('user_quiz_responses')
        .insert({
          user_id: userId,
          nicho_identificado: identifiedNiche,
          respostas_completas: {
            answers,
            otherInputs
          }
        });

      if (error) throw error;

      // Update profile
      await supabase
        .from('profiles')
        .update({ quiz_completed: true })
        .eq('id', userId);

      toast({
        title: "Respostas enviadas!",
        description: "Obrigado por responder ao quiz. Estamos personalizando sua experiência.",
      });
      
      navigate(`/briefing/${identifiedNiche}`);
    } catch (error: any) {
      toast({
        title: "Erro ao salvar",
        description: error.message || "Ocorreu um erro ao salvar suas respostas.",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-8">
      <div className="w-full max-w-2xl space-y-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Quiz de Qualificação de Nicho
            </h1>
            <p className="max-w-md text-muted-foreground">
              Oi! Para que a LogosIA possa otimizar sua estratégia de marketing com a máxima precisão, precisamos entender um pouco mais sobre o seu negócio.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm font-medium">
            <span className="text-muted-foreground">Pergunta {currentStep + 1} de {questions.length}</span>
            <span className="text-primary">{Math.round(progress)}% completo</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm shadow-xl">
          <CardHeader>
            <CardTitle className="text-xl leading-tight">
              {currentQuestion.id}. {currentQuestion.question}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <RadioGroup
              value={answers[currentQuestion.id]}
              onValueChange={(val) => setAnswers(prev => ({ ...prev, [currentQuestion.id]: val }))}
              className="space-y-3"
            >
              {currentQuestion.options.map((option) => (
                <div key={option.id} className="flex flex-col gap-2">
                  <Label
                    htmlFor={`q${currentQuestion.id}-${option.id}`}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all hover:bg-accent/50 ${
                      answers[currentQuestion.id] === option.id
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border/50 bg-background/50"
                    }`}
                  >
                    <RadioGroupItem
                      value={option.id}
                      id={`q${currentQuestion.id}-${option.id}`}
                      className="mt-1"
                    />
                    <span className="flex-1 font-medium">{option.label}</span>
                  </Label>
                  
                  {option.hasInput && answers[currentQuestion.id] === option.id && (
                    <Input
                      placeholder="Especifique aqui..."
                      value={otherInputs[currentQuestion.id] || ''}
                      onChange={(e) => setOtherInputs(prev => ({ ...prev, [currentQuestion.id]: e.target.value }))}
                      className="ml-9 w-[calc(100%-2.25rem)]"
                      autoFocus
                    />
                  )}
                </div>
              ))}
            </RadioGroup>

            <div className="flex items-center justify-between pt-4 gap-4">
              <Button
                variant="ghost"
                onClick={handleBack}
                disabled={currentStep === 0 || isSubmitting}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Anterior
              </Button>
              <Button
                onClick={handleNext}
                disabled={isSubmitting}
                className="min-w-[120px] gap-2 gradient-primary"
              >
                {currentStep === questions.length - 1 ? (
                  <>
                    Finalizar
                    <CheckCircle2 className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    Próxima
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground px-4">
          Suas respostas nos ajudarão a direcionar você para o briefing mais adequado e a personalizar a atuação dos nossos Agentes de IA.
        </p>
      </div>
    </div>
  );
}
