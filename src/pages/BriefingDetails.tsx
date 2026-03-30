import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, ArrowRight, CheckCircle, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

const nicheNames: Record<string, string> = {
  automotivo: "Automotivo (Agências de Carro / Concessionárias)",
  saude_bem_estar: "Saúde e Bem-Estar",
  varejo_ecommerce: "Varejo e E-commerce",
  educacao_conhecimento: "Educação e Conhecimento",
  alimentacao_bebidas: "Alimentação e Bebidas",
  imobiliario: "Imobiliário",
  servicos_b2b: "Serviços Profissionais B2B",
  pet: "Pet",
  financas_investimentos: "Finanças e Investimentos",
  tecnologia_saas: "Tecnologia e Software (SaaS)",
  outro: "Personalizado"
};

export default function BriefingDetails() {
  const { nicho } = useParams<{ nicho: string }>();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchBriefing = async () => {
      try {
        const response = await fetch(`/briefings/briefing_nicho_${nicho}.md`);
        if (response.ok) {
          const text = await response.text();
          setContent(text);
        } else {
          // Fallback content if file not found
          setContent(`# Briefing para o Nicho: ${nicheNames[nicho || ''] || nicho}

Este é o seu briefing personalizado para ajudar o Agente Salomão a entender melhor o seu negócio.

## 1. Visão Geral
Descreva seu negócio e o que o torna único.

## 2. Público-Alvo
Quem são seus clientes ideais?

## 3. Principais Desafios
O que você está tentando resolver com marketing digital?

## 4. Metas
O que você espera alcançar nos próximos 3 meses?
`);
        }
      } catch (error) {
        console.error("Error fetching briefing:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchBriefing();
  }, [nicho]);

  const handleSubmitBriefing = async () => {
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Não autenticado");

      // Update profile to mark quiz as completed
      await supabase
        .from('profiles')
        .update({ quiz_completed: true })
        .eq('id', session.user.id);

      // Simulate sending to Salomão
      await new Promise(resolve => setTimeout(resolve, 2000));

      toast({
        title: "Briefing Enviado!",
        description: "Os dados foram enviados para o Agente Salomão. Ele começará a trabalhar na sua estratégia em breve.",
      });

      navigate('/dashboard');
    } catch (error: any) {
      toast({
        title: "Erro",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-12 space-y-8">
      <div className="flex flex-col items-center text-center space-y-4">
        <div className="p-3 bg-primary/10 rounded-full">
          <FileText className="h-8 w-8 text-primary" />
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">
            Briefing Personalizado: {nicheNames[nicho || ''] || nicho}
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Com base nas suas respostas no quiz, preparamos este modelo de briefing. 
            Ele será usado para alimentar o Agente Salomão e gerar sua estratégia completa.
          </p>
        </div>
      </div>

      <Card className="border-border/50 shadow-lg">
        <CardHeader className="bg-muted/30 border-b border-border/50">
          <CardTitle className="text-lg">Conteúdo do Briefing</CardTitle>
        </CardHeader>
        <CardContent className="pt-8 prose prose-slate dark:prose-invert max-w-none">
          <ReactMarkdown>{content}</ReactMarkdown>
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
        <Button 
          variant="outline" 
          onClick={() => navigate('/niche-quiz')}
          disabled={submitting}
        >
          Refazer Quiz
        </Button>
        <Button 
          className="gradient-primary min-w-[200px]" 
          onClick={handleSubmitBriefing}
          disabled={submitting}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <CheckCircle className="h-4 w-4 mr-2" />
          )}
          Confirmar e Enviar para o Salomão
          {!submitting && <ArrowRight className="h-4 w-4 ml-2" />}
        </Button>
      </div>
    </div>
  );
}
