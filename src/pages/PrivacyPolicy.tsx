import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PrivacyPolicy() {
  const navigate = useNavigate();

  const handleBack = () => {
    const canGoBack = (window.history.state?.idx ?? 0) > 0;
    if (canGoBack) navigate(-1);
    else navigate('/dashboard');
  };

  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="mx-auto max-w-3xl">
        <Button
          variant="ghost"
          onClick={handleBack}
          className="mb-6 gap-2 text-muted-foreground hover:text-foreground group"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          Voltar
        </Button>

        <h1 className="text-3xl font-bold mb-2">Política de Privacidade</h1>
        <p className="text-sm text-muted-foreground mb-8">Última atualização: 12 de março de 2026</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold mb-2">1. Informações que coletamos</h2>
            <p className="text-muted-foreground">
              Coletamos informações que você nos fornece diretamente, incluindo: nome, endereço de e-mail, informações de conta de anúncios (Meta Ads, Google Ads, TikTok Ads), dados de campanhas publicitárias e métricas de desempenho. Também coletamos automaticamente informações de uso, como endereço IP, tipo de navegador, páginas visitadas e tempo de acesso.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-semibold mb-2">2. Como usamos suas informações</h2>
            <p className="text-muted-foreground">
              Usamos as informações coletadas para fornecer, manter e melhorar nossos serviços, processar transações, enviar notificações técnicas e de suporte, responder a comentários e perguntas, e monitorar e analisar tendências de uso.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-semibold mb-2">3. Compartilhamento de informações</h2>
            <p className="text-muted-foreground">
              Não vendemos, negociamos ou transferimos suas informações pessoais para terceiros sem seu consentimento, exceto quando necessário para fornecer nossos serviços ou quando exigido por lei.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-semibold mb-2">4. Segurança</h2>
            <p className="text-muted-foreground">
              Implementamos medidas de segurança técnicas e organizacionais para proteger suas informações contra acesso não autorizado, alteração, divulgação ou destruição.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-semibold mb-2">5. Seus direitos</h2>
            <p className="text-muted-foreground">
              Você tem o direito de acessar, corrigir ou excluir suas informações pessoais. Para exercer esses direitos, entre em contato conosco através dos canais disponíveis na plataforma.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
