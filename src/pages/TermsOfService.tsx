import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function TermsOfService() {
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

        <h1 className="text-3xl font-bold mb-2">Termos de Serviço</h1>
        <p className="text-sm text-muted-foreground mb-8">Última atualização: 12 de março de 2026</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold mb-2">1. Aceitação dos termos</h2>
            <p className="text-muted-foreground">
              Ao acessar ou usar a plataforma LogosIA, você concorda em cumprir estes Termos de Serviço. Se você não concordar com qualquer parte destes termos, não poderá acessar ou usar nossos serviços.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-semibold mb-2">2. Uso da plataforma</h2>
            <p className="text-muted-foreground">
              Você concorda em usar a plataforma apenas para fins legais e de acordo com estes termos. É proibido usar a plataforma de maneira que possa danificar, desabilitar ou sobrecarregar nossos servidores ou redes.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-semibold mb-2">3. Propriedade intelectual</h2>
            <p className="text-muted-foreground">
              Todo o conteúdo da plataforma, incluindo textos, gráficos, logos e software, é propriedade da LogosIA e está protegido por leis de direitos autorais e outras leis de propriedade intelectual.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-semibold mb-2">4. Limitação de responsabilidade</h2>
            <p className="text-muted-foreground">
              A LogosIA não será responsável por quaisquer danos indiretos, incidentais, especiais ou consequentes resultantes do uso ou incapacidade de usar nossos serviços.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-semibold mb-2">5. Alterações nos termos</h2>
            <p className="text-muted-foreground">
              Reservamos o direito de modificar estes termos a qualquer momento. As alterações entrarão em vigor imediatamente após a publicação. O uso continuado da plataforma após as alterações constitui aceitação dos novos termos.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
