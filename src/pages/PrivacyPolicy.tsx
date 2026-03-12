import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="mx-auto max-w-3xl">
        <Button variant="ghost" asChild className="mb-6">
          <Link to="/auth"><ArrowLeft className="mr-2 h-4 w-4" /> Voltar</Link>
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
            <p className="text-muted-foreground">Utilizamos suas informações para:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>Fornecer, manter e melhorar nossos serviços</li>
              <li>Processar e analisar dados de campanhas publicitárias</li>
              <li>Gerar insights e recomendações de otimização com IA</li>
              <li>Enviar relatórios e notificações sobre suas campanhas</li>
              <li>Comunicar atualizações, suporte e informações sobre o serviço</li>
              <li>Proteger contra atividades fraudulentas ou não autorizadas</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">3. Compartilhamento de informações</h2>
            <p className="text-muted-foreground">
              Não vendemos suas informações pessoais. Podemos compartilhar dados com: provedores de serviço que nos auxiliam na operação da plataforma (como hospedagem, análise e processamento de pagamentos), plataformas de anúncios conectadas (Meta, Google, TikTok) conforme necessário para fornecer nossos serviços, e quando exigido por lei ou para proteger nossos direitos legais.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">4. Segurança dos dados</h2>
            <p className="text-muted-foreground">
              Implementamos medidas de segurança técnicas e organizacionais para proteger suas informações, incluindo criptografia de dados em trânsito e em repouso, controles de acesso e monitoramento contínuo. Tokens de acesso de plataformas terceiras são armazenados de forma criptografada.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">5. Retenção de dados</h2>
            <p className="text-muted-foreground">
              Mantemos suas informações pelo tempo necessário para fornecer nossos serviços ou conforme exigido por lei. Você pode solicitar a exclusão de seus dados a qualquer momento entrando em contato conosco.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">6. Seus direitos</h2>
            <p className="text-muted-foreground">Você tem direito a:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>Acessar, corrigir ou excluir seus dados pessoais</li>
              <li>Revogar o consentimento para o processamento de dados</li>
              <li>Solicitar a portabilidade de seus dados</li>
              <li>Desconectar contas de plataformas de anúncios a qualquer momento</li>
              <li>Optar por não receber comunicações de marketing</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">7. Cookies e tecnologias de rastreamento</h2>
            <p className="text-muted-foreground">
              Utilizamos cookies e tecnologias similares para manter sua sessão, lembrar suas preferências e analisar o uso da plataforma. Você pode controlar o uso de cookies através das configurações do seu navegador.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">8. Integrações com terceiros</h2>
            <p className="text-muted-foreground">
              Nossa plataforma se integra com serviços de terceiros como Meta (Facebook/Instagram), Google Ads, TikTok Ads e Shopify. Ao conectar essas contas, você autoriza o acesso aos dados necessários conforme as permissões solicitadas. Cada plataforma possui sua própria política de privacidade que recomendamos consultar.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">9. Uso de Inteligência Artificial</h2>
            <p className="text-muted-foreground">
              Utilizamos modelos de IA para analisar dados de campanhas, gerar insights e fornecer recomendações. Os dados processados por IA são tratados com as mesmas medidas de segurança aplicadas a todos os outros dados da plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">10. Alterações nesta política</h2>
            <p className="text-muted-foreground">
              Podemos atualizar esta política periodicamente. Notificaremos sobre mudanças significativas por e-mail ou através de um aviso na plataforma. O uso continuado após as alterações constitui aceitação da política atualizada.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">11. Contato</h2>
            <p className="text-muted-foreground">
              Para questões sobre esta política ou sobre seus dados pessoais, entre em contato conosco pelo e-mail: <a href="mailto:carvalho@scalpergx.com.br" className="text-primary hover:underline">carvalho@scalpergx.com.br</a>
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-border text-center text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} HumanizeAI. Todos os direitos reservados.</p>
        </div>
      </div>
    </div>
  );
}
