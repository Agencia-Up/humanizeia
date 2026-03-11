import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, ExternalLink, LineChart, AlertTriangle } from 'lucide-react';

export function GoogleAnalyticsSettingsTab() {
  // GA4 integration is coming soon — show informational UI
  const isConnected = false;

  return (
    <div className="space-y-6">
      {/* Connection Card */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
                <LineChart className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <CardTitle className="text-lg">Google Analytics 4</CardTitle>
                <CardDescription>Dados de tráfego, conversões e comportamento dos visitantes do seu site</CardDescription>
              </div>
            </div>
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Em breve
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-amber-500/30 bg-amber-500/5">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <AlertDescription className="text-sm">
              A integração com Google Analytics 4 será liberada em breve. Quando conectar o Google Ads, 
              as permissões do Analytics já são solicitadas automaticamente — assim que liberarmos, 
              seus dados estarão disponíveis sem precisar reconectar.
            </AlertDescription>
          </Alert>

          <Button disabled className="gap-2 opacity-50">
            <LineChart className="h-4 w-4" />
            Conectar Google Analytics (em breve)
          </Button>
        </CardContent>
      </Card>

      {/* What GA4 will provide */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg">Métricas que estarão disponíveis</CardTitle>
          <CardDescription>Dados que serão sincronizados automaticamente com o GA4</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[
              'Usuários Ativos', 'Sessões', 'Pageviews', 'Taxa de Rejeição',
              'Duração da Sessão', 'Conversões', 'Receita Total',
              'Origens de Tráfego', 'Páginas mais visitadas',
              'Dispositivos', 'Países', 'Cidades',
              'Funil de Conversão', 'Eventos Personalizados', 'Tempo Real',
            ].map((metric) => (
              <div key={metric} className="flex items-center gap-2 rounded-md border border-border/40 px-3 py-2 text-xs bg-muted/20">
                <CheckCircle className="h-3 w-3 text-muted-foreground" />
                {metric}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* What is GA4 - for beginners */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg">❓ O que é Google Analytics 4?</CardTitle>
          <CardDescription>Entenda para que serve essa ferramenta</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            O <strong className="text-foreground">Google Analytics 4 (GA4)</strong> é uma ferramenta gratuita do Google que mostra 
            tudo que acontece no seu site: quantas pessoas visitam, de onde elas vêm, quais páginas 
            acessam e quantas acabam comprando.
          </p>
          <div className="space-y-2">
            <p className="font-medium text-foreground">Com o GA4 integrado você poderá:</p>
            <ul className="space-y-1.5 list-none">
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span>Ver quantas pessoas visitam seu site por dia, semana ou mês</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span>Saber de onde vêm (Google, Instagram, Facebook, direto)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span>Descobrir quais páginas do site mais atraem visitantes</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span>Acompanhar o funil: visita → carrinho → checkout → compra</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span>Cruzar dados do Analytics com Google Ads para ver o caminho completo do cliente</span>
              </li>
            </ul>
          </div>
          <Button variant="link" className="p-0 h-auto text-xs" asChild>
            <a href="https://analytics.google.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
              Abrir Google Analytics <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* Pre-requisites */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg">⚙️ Pré-requisitos técnicos</CardTitle>
          <CardDescription>O que é necessário para quando a integração for liberada</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>1. Ter uma <strong className="text-foreground">propriedade GA4</strong> criada no Google Analytics</p>
          <p>2. Ter a tag do GA4 instalada no seu site (código <code className="bg-muted px-1.5 py-0.5 rounded text-xs">G-XXXXXXX</code>)</p>
          <p>3. Ativar a <strong className="text-foreground">Google Analytics Data API</strong> no <a href="https://console.cloud.google.com/apis/library" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">Google Cloud Console <ExternalLink className="h-3 w-3" /></a></p>
          <p>4. Usar as mesmas credenciais OAuth já configuradas para o Google Ads</p>
        </CardContent>
      </Card>
    </div>
  );
}
