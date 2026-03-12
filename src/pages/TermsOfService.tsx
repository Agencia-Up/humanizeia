import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="mx-auto max-w-3xl">
        <Button variant="ghost" asChild className="mb-6">
          <Link to="/auth"><ArrowLeft className="mr-2 h-4 w-4" /> Voltar</Link>
        </Button>

        <h1 className="text-3xl font-bold mb-2">Termos de Serviço</h1>
        <p className="text-sm text-muted-foreground mb-8">Última atualização: 12 de março de 2026</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold mb-2">1. Aceitação dos termos</h2>
            <p className="text-muted-foreground">
              Ao acessar ou usar a plataforma HumanizeAI, você concorda em cumprir estes Termos de Serviço. Se você não concordar com qualquer parte destes termos, não poderá acessar ou usar nossos serviços.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">2. Descrição do serviço</h2>
            <p className="text-muted-foreground">
              A HumanizeAI é uma plataforma de gestão e otimização de campanhas publicitárias que utiliza inteligência artificial para análise de dados, geração de insights, criação de conteúdo e relatórios automatizados. Os serviços incluem integração com plataformas de anúncios, ferramentas de copywriting, estúdio criativo e automação de relatórios.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">3. Conta do usuário</h2>
            <p className="text-muted-foreground">
              Você é responsável por manter a confidencialidade de suas credenciais de acesso e por todas as atividades realizadas em sua conta. Você deve nos notificar imediatamente sobre qualquer uso não autorizado de sua conta.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">4. Uso aceitável</h2>
            <p className="text-muted-foreground">Você concorda em não:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>Usar o serviço para fins ilegais ou não autorizados</li>
              <li>Tentar acessar dados de outros usuários sem autorização</li>
              <li>Interferir no funcionamento da plataforma ou de sua infraestrutura</li>
              <li>Violar direitos de propriedade intelectual de terceiros</li>
              <li>Usar o serviço para enviar spam ou conteúdo malicioso</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">5. Integrações com plataformas de terceiros</h2>
            <p className="text-muted-foreground">
              Ao conectar contas de plataformas de terceiros (Meta, Google, TikTok, Shopify), você autoriza a HumanizeAI a acessar e processar os dados disponibilizados conforme as permissões concedidas. A HumanizeAI não se responsabiliza por alterações nas APIs ou políticas dessas plataformas que possam afetar o funcionamento dos serviços.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">6. Propriedade intelectual</h2>
            <p className="text-muted-foreground">
              Todo o conteúdo, design, código e funcionalidades da plataforma são propriedade da HumanizeAI. Os conteúdos gerados pela IA para o usuário (copies, criativos, relatórios) são de propriedade do usuário que os gerou.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">7. Limitação de responsabilidade</h2>
            <p className="text-muted-foreground">
              A HumanizeAI fornece insights e recomendações baseados em IA como ferramenta de apoio à decisão. Não garantimos resultados específicos de campanhas publicitárias. O usuário é o único responsável pelas decisões tomadas com base nas informações fornecidas pela plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">8. Disponibilidade do serviço</h2>
            <p className="text-muted-foreground">
              Nos esforçamos para manter o serviço disponível continuamente, mas não garantimos disponibilidade ininterrupta. Manutenções programadas e eventos fora de nosso controle podem causar interrupções temporárias.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">9. Rescisão</h2>
            <p className="text-muted-foreground">
              Você pode encerrar sua conta a qualquer momento. Reservamo-nos o direito de suspender ou encerrar contas que violem estes termos. Após o encerramento, seus dados serão tratados conforme nossa Política de Privacidade.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">10. Alterações nos termos</h2>
            <p className="text-muted-foreground">
              Podemos modificar estes termos a qualquer momento. Mudanças significativas serão comunicadas com antecedência. O uso continuado do serviço após as alterações constitui aceitação dos novos termos.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">11. Lei aplicável</h2>
            <p className="text-muted-foreground">
              Estes termos são regidos pelas leis da República Federativa do Brasil. Quaisquer disputas serão resolvidas no foro da comarca de domicílio do usuário, conforme previsto no Código de Defesa do Consumidor.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">12. Contato</h2>
            <p className="text-muted-foreground">
              Para questões sobre estes termos, entre em contato pelo e-mail: <a href="mailto:carvalho@scalpergx.com.br" className="text-primary hover:underline">carvalho@scalpergx.com.br</a>
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
