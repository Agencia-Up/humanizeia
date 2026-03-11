import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, ExternalLink, Tag, Info } from 'lucide-react';

export function GoogleTagManagerSettingsTab() {
  return (
    <div className="space-y-6">
      {/* Connection Card */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                <Tag className="h-5 w-5 text-cyan-500" />
              </div>
              <div>
                <CardTitle className="text-lg">Google Tag Manager</CardTitle>
                <CardDescription>Gerencie tags e pixels do seu site sem mexer no código</CardDescription>
              </div>
            </div>
            <Badge variant="secondary">
              <Info className="h-3 w-3 mr-1" />
              Opcional
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-border/50 bg-muted/30">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm">
              O Google Tag Manager é opcional. Ele é útil se você já usa GTM para gerenciar
              os códigos de rastreamento (pixels) do seu site. Se não usa, pode ignorar esta aba.
            </AlertDescription>
          </Alert>

          <Button disabled className="gap-2 opacity-50">
            <Tag className="h-4 w-4" />
            Conectar Tag Manager (em breve)
          </Button>
        </CardContent>
      </Card>

      {/* What GTM provides */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg">Funcionalidades disponíveis</CardTitle>
          <CardDescription>O que será possível fazer com o GTM integrado</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[
              'Ver tags instaladas', 'Pixel do Meta', 'Pixel do Google',
              'Pixel do TikTok', 'Conversões personalizadas', 'Eventos do site',
              'Tags de remarketing', 'Variáveis personalizadas', 'Debug de tags',
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-2 rounded-md border border-border/40 px-3 py-2 text-xs bg-muted/20">
                <CheckCircle className="h-3 w-3 text-muted-foreground" />
                {feature}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* What is GTM - for beginners */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg">❓ O que é Google Tag Manager?</CardTitle>
          <CardDescription>Explicação simples para quem não é técnico</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            O <strong className="text-foreground">Google Tag Manager (GTM)</strong> é uma ferramenta que permite 
            adicionar e gerenciar códigos de rastreamento no seu site sem precisar de um programador.
          </p>
          <div className="space-y-2">
            <p className="font-medium text-foreground">Exemplos do que o GTM faz:</p>
            <ul className="space-y-1.5 list-none">
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span><strong>Pixel do Facebook:</strong> rastreia quem visitou seu site para mostrar anúncios depois</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span><strong>Google Analytics:</strong> conta quantas pessoas visitam seu site</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span><strong>Conversões:</strong> registra quando alguém compra algo no seu site</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span><strong>TikTok Pixel:</strong> rastreia visitantes para campanhas no TikTok</span>
              </li>
            </ul>
          </div>
          <div className="rounded-lg bg-muted/30 p-3 text-xs">
            <p className="font-medium text-foreground/80 mb-1">💡 Dica:</p>
            <p>Se você não sabe o que é GTM ou nunca configurou, provavelmente não precisa desta integração agora. 
            Foque primeiro no Google Ads e Analytics.</p>
          </div>
          <Button variant="link" className="p-0 h-auto text-xs" asChild>
            <a href="https://tagmanager.google.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
              Abrir Google Tag Manager <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* Pre-requisites */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg">⚙️ Pré-requisitos técnicos</CardTitle>
          <CardDescription>O que é necessário para a integração</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>1. Ter uma <strong className="text-foreground">conta no GTM</strong> com pelo menos um container criado</p>
          <p>2. Ter o código do GTM (<code className="bg-muted px-1.5 py-0.5 rounded text-xs">GTM-XXXXX</code>) instalado no seu site</p>
          <p>3. Ativar a <strong className="text-foreground">Tag Manager API</strong> no <a href="https://console.cloud.google.com/apis/library" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">Google Cloud Console <ExternalLink className="h-3 w-3" /></a></p>
          <p>4. Usar as mesmas credenciais OAuth configuradas para o Google Ads</p>
        </CardContent>
      </Card>
    </div>
  );
}
