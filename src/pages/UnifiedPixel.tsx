import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import {
  Code2, Copy, CheckCircle, Activity, Bug, Zap,
  Monitor, ShoppingCart, FileText, MousePointerClick,
  Eye, UserPlus, CreditCard, Target
} from 'lucide-react';

const STANDARD_EVENTS = [
  { name: 'PageView', icon: Eye, description: 'Visualização de página', autoFire: true },
  { name: 'ViewContent', icon: FileText, description: 'Visualização de produto', autoFire: false },
  { name: 'AddToCart', icon: ShoppingCart, description: 'Adicionou ao carrinho', autoFire: false },
  { name: 'InitiateCheckout', icon: CreditCard, description: 'Iniciou checkout', autoFire: false },
  { name: 'Purchase', icon: Target, description: 'Compra realizada', autoFire: false },
  { name: 'Lead', icon: UserPlus, description: 'Lead gerado', autoFire: false },
  { name: 'CompleteRegistration', icon: UserPlus, description: 'Cadastro completo', autoFire: false },
  { name: 'Click', icon: MousePointerClick, description: 'Clique em elemento', autoFire: false },
];

interface PixelConfig {
  metaPixelId: string;
  googleAdsId: string;
  googleConversionLabel: string;
  tiktokPixelId: string;
  debugMode: boolean;
}

// Simulated event log for debug mode
interface EventLog {
  id: string;
  event: string;
  platform: string;
  timestamp: string;
  status: 'success' | 'error' | 'pending';
  payload?: Record<string, any>;
}

export default function UnifiedPixel() {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [config, setConfig] = useState<PixelConfig>({
    metaPixelId: '',
    googleAdsId: '',
    googleConversionLabel: '',
    tiktokPixelId: '',
    debugMode: false,
  });

  const [eventLogs] = useState<EventLog[]>([
    { id: '1', event: 'PageView', platform: 'Meta', timestamp: new Date().toISOString(), status: 'success' },
    { id: '2', event: 'PageView', platform: 'Google', timestamp: new Date().toISOString(), status: 'success' },
    { id: '3', event: 'PageView', platform: 'TikTok', timestamp: new Date().toISOString(), status: 'success' },
    { id: '4', event: 'ViewContent', platform: 'Meta', timestamp: new Date(Date.now() - 5000).toISOString(), status: 'success', payload: { content_name: 'Produto X', value: 99.90 } },
    { id: '5', event: 'AddToCart', platform: 'Google', timestamp: new Date(Date.now() - 12000).toISOString(), status: 'error' },
  ]);

  const { data: adAccounts = [] } = useQuery({
    queryKey: ['pixel-ad-accounts', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('ad_accounts').select('*').eq('is_active', true);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const activePlatforms = [
    config.metaPixelId ? 'Meta' : null,
    config.googleAdsId ? 'Google' : null,
    config.tiktokPixelId ? 'TikTok' : null,
  ].filter(Boolean);

  const generateScript = () => {
    const parts: string[] = [
      `<!-- MIDAS Unified Pixel -->`,
      `<script>`,
      `(function(w,d,t){`,
      `  w._midas=w._midas||[];`,
      `  w.midasTrack=function(e,p){w._midas.push({event:e,params:p||{},ts:Date.now()});`,
    ];

    if (config.metaPixelId) {
      parts.push(`    // Meta Pixel`);
      parts.push(`    if(w.fbq)fbq('track',e,p);`);
    }
    if (config.googleAdsId) {
      parts.push(`    // Google Ads`);
      parts.push(`    if(w.gtag)gtag('event',e==='Purchase'?'conversion':e,`);
      parts.push(`      e==='Purchase'?{send_to:'${config.googleAdsId}/${config.googleConversionLabel}',value:p?.value,currency:p?.currency||'BRL'}:p);`);
    }
    if (config.tiktokPixelId) {
      parts.push(`    // TikTok Pixel`);
      parts.push(`    if(w.ttq)ttq.track(e,p);`);
    }
    if (config.debugMode) {
      parts.push(`    console.log('[MIDAS Pixel]',e,p);`);
    }
    parts.push(`  };`);

    // Platform init scripts
    if (config.metaPixelId) {
      parts.push(`  // Meta Pixel Init`);
      parts.push(`  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(w,d,'script','https://connect.facebook.net/en_US/fbevents.js');`);
      parts.push(`  fbq('init','${config.metaPixelId}');`);
    }
    if (config.googleAdsId) {
      parts.push(`  // Google Ads Init`);
      parts.push(`  var gs=d.createElement('script');gs.async=true;gs.src='https://www.googletagmanager.com/gtag/js?id=${config.googleAdsId}';d.head.appendChild(gs);`);
      parts.push(`  w.dataLayer=w.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${config.googleAdsId}');`);
    }
    if (config.tiktokPixelId) {
      parts.push(`  // TikTok Pixel Init`);
      parts.push(`  !function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;ttq._t=ttq._t||{};ttq._t[e+\"_\"+Math.floor(Date.now()/1e3)]=1;var o=document.createElement("script");o.type="text/javascript";o.async=!0;o.src=i+\"?sdkid=\"+e+\"&lib=\"+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};`);
      parts.push(`  ttq.load('${config.tiktokPixelId}');ttq.page();}(w,d,'ttq');`);
    }

    parts.push(`  midasTrack('PageView');`);
    parts.push(`})(window,document);`);
    parts.push(`</script>`);
    parts.push(`<!-- End MIDAS Unified Pixel -->`);

    return parts.join('\n');
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generateScript());
    setCopied(true);
    toast.success('Script copiado!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold lg:text-3xl flex items-center gap-3">
            <Code2 className="h-7 w-7 text-primary" />
            Pixel Unificado
          </h1>
          <p className="text-muted-foreground">
            Um único script para disparar eventos para Meta, Google e TikTok
          </p>
        </div>

        <Tabs defaultValue="setup" className="space-y-6">
          <TabsList>
            <TabsTrigger value="setup" className="gap-2"><Zap className="h-4 w-4" /> Configuração</TabsTrigger>
            <TabsTrigger value="events" className="gap-2"><Activity className="h-4 w-4" /> Eventos</TabsTrigger>
            <TabsTrigger value="debug" className="gap-2"><Bug className="h-4 w-4" /> Debug Mode</TabsTrigger>
          </TabsList>

          {/* SETUP TAB */}
          <TabsContent value="setup" className="space-y-6">
            <div className="grid gap-6 md:grid-cols-3">
              {/* Meta Pixel */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">📘</span>
                    <CardTitle className="text-base">Meta Pixel</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <Label htmlFor="meta-pixel">Pixel ID</Label>
                  <Input
                    id="meta-pixel"
                    placeholder="123456789"
                    value={config.metaPixelId}
                    onChange={(e) => setConfig(c => ({ ...c, metaPixelId: e.target.value }))}
                  />
                </CardContent>
              </Card>

              {/* Google Ads */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🔵</span>
                    <CardTitle className="text-base">Google Ads</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label htmlFor="google-id">Conversion ID</Label>
                    <Input
                      id="google-id"
                      placeholder="AW-123456789"
                      value={config.googleAdsId}
                      onChange={(e) => setConfig(c => ({ ...c, googleAdsId: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="google-label">Conversion Label</Label>
                    <Input
                      id="google-label"
                      placeholder="AbCdEf"
                      value={config.googleConversionLabel}
                      onChange={(e) => setConfig(c => ({ ...c, googleConversionLabel: e.target.value }))}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* TikTok */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🎵</span>
                    <CardTitle className="text-base">TikTok Pixel</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <Label htmlFor="tiktok-pixel">Pixel ID</Label>
                  <Input
                    id="tiktok-pixel"
                    placeholder="C1234567890"
                    value={config.tiktokPixelId}
                    onChange={(e) => setConfig(c => ({ ...c, tiktokPixelId: e.target.value }))}
                  />
                </CardContent>
              </Card>
            </div>

            {/* Status */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Plataformas Ativas</CardTitle>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="debug-toggle" className="text-sm">Debug Mode</Label>
                    <Switch
                      id="debug-toggle"
                      checked={config.debugMode}
                      onCheckedChange={(v) => setConfig(c => ({ ...c, debugMode: v }))}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {activePlatforms.length === 0 ? (
                  <Alert>
                    <AlertDescription>Insira pelo menos um Pixel ID acima para gerar o script.</AlertDescription>
                  </Alert>
                ) : (
                  <div className="flex gap-2 mb-4">
                    {activePlatforms.map(p => (
                      <Badge key={p} className="bg-primary/20 text-primary border-primary/30">{p}</Badge>
                    ))}
                    {config.debugMode && <Badge variant="outline" className="text-yellow-400 border-yellow-500/30">🐛 Debug</Badge>}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Generated Script */}
            {activePlatforms.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Script para Instalação</CardTitle>
                    <Button size="sm" onClick={handleCopy} className="gap-2">
                      {copied ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copied ? 'Copiado!' : 'Copiar'}
                    </Button>
                  </div>
                  <CardDescription>
                    Cole este script no {'<head>'} do seu site, antes do fechamento da tag
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="bg-muted/50 rounded-lg p-4 overflow-x-auto text-xs font-mono whitespace-pre border border-border/50 max-h-80">
                    {generateScript()}
                  </pre>

                  <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <p className="text-sm font-medium mb-1">Como disparar eventos no seu site:</p>
                    <pre className="text-xs font-mono bg-muted/50 rounded p-2">
{`// Visualização de produto
midasTrack('ViewContent', { content_name: 'Produto X', value: 99.90 });

// Compra
midasTrack('Purchase', { value: 199.90, currency: 'BRL' });

// Lead
midasTrack('Lead', { content_name: 'Newsletter' });`}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* EVENTS TAB */}
          <TabsContent value="events" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Eventos Padrão Suportados</CardTitle>
                <CardDescription>Estes eventos são disparados automaticamente para todas as plataformas configuradas</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2">
                  {STANDARD_EVENTS.map((evt) => (
                    <div key={evt.name} className="flex items-center justify-between rounded-lg border border-border/50 p-3 bg-muted/20">
                      <div className="flex items-center gap-3">
                        <evt.icon className="h-4 w-4 text-primary" />
                        <div>
                          <p className="font-medium text-sm">{evt.name}</p>
                          <p className="text-xs text-muted-foreground">{evt.description}</p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {config.metaPixelId && <Badge variant="outline" className="text-[10px] px-1">Meta</Badge>}
                        {config.googleAdsId && <Badge variant="outline" className="text-[10px] px-1">Google</Badge>}
                        {config.tiktokPixelId && <Badge variant="outline" className="text-[10px] px-1">TikTok</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* DEBUG TAB */}
          <TabsContent value="debug" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Bug className="h-5 w-5" />
                      Debug Mode
                    </CardTitle>
                    <CardDescription>Visualize os eventos disparados em tempo real</CardDescription>
                  </div>
                  <Switch
                    checked={config.debugMode}
                    onCheckedChange={(v) => setConfig(c => ({ ...c, debugMode: v }))}
                  />
                </div>
              </CardHeader>
              <CardContent>
                {!config.debugMode ? (
                  <Alert>
                    <AlertDescription>Ative o Debug Mode para ver os eventos em tempo real. Os eventos também serão logados no console do navegador.</AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-2">
                    {eventLogs.map((log, i) => (
                      <motion.div
                        key={log.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="flex items-center justify-between rounded-lg border border-border/50 p-3 bg-muted/20"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`h-2 w-2 rounded-full ${log.status === 'success' ? 'bg-green-400' : log.status === 'error' ? 'bg-red-400' : 'bg-yellow-400'}`} />
                          <div>
                            <p className="font-mono text-sm font-medium">{log.event}</p>
                            {log.payload && (
                              <p className="text-xs text-muted-foreground font-mono">{JSON.stringify(log.payload)}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">{log.platform}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(log.timestamp).toLocaleTimeString('pt-BR')}
                          </span>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Verificação de Instalação</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { platform: 'Meta Pixel', configured: !!config.metaPixelId, tool: 'Meta Pixel Helper (extensão Chrome)' },
                    { platform: 'Google Ads', configured: !!config.googleAdsId, tool: 'Google Tag Assistant' },
                    { platform: 'TikTok Pixel', configured: !!config.tiktokPixelId, tool: 'TikTok Pixel Helper' },
                  ].map((p) => (
                    <div key={p.platform} className="flex items-center justify-between rounded-lg border border-border/40 p-3">
                      <div className="flex items-center gap-2">
                        {p.configured ? (
                          <CheckCircle className="h-4 w-4 text-green-400" />
                        ) : (
                          <Monitor className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-sm font-medium">{p.platform}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{p.configured ? `Use: ${p.tool}` : 'Não configurado'}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
