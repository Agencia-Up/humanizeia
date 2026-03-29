import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Save, Eye, EyeOff, Sparkles, Image, Brain, Info } from 'lucide-react';

const STORAGE_KEY = 'logosia-ai-settings';

interface AISettings {
  copyProvider: string;
  analysisProvider: string;
  imageProvider: string;
  openaiKey: string;
  geminiKey: string;
  anthropicKey: string;
  autoFallback: boolean;
  autoSuggestions: boolean;
  conservativeMode: boolean;
}

const defaultSettings: AISettings = {
  copyProvider: 'lovable',
  analysisProvider: 'lovable',
  imageProvider: 'lovable',
  openaiKey: '',
  geminiKey: '',
  anthropicKey: '',
  autoFallback: true,
  autoSuggestions: true,
  conservativeMode: true,
};

const copyProviders = [
  { value: 'lovable', label: 'Lovable AI (Padrão)', description: 'Gemini Flash via gateway — incluso no plano', recommended: true },
  { value: 'gemini', label: 'Google Gemini', description: 'Gemini 2.5 Flash direto — requer API key' },
  { value: 'openai', label: 'OpenAI GPT-4', description: 'GPT-4 Turbo — melhor qualidade, maior custo' },
  { value: 'anthropic', label: 'Anthropic Claude', description: 'Claude Sonnet — excelente para copies longas' },
];

const analysisProviders = [
  { value: 'lovable', label: 'Lovable AI (Padrão)', description: 'Gemini Flash via gateway — incluso no plano', recommended: true },
  { value: 'gemini', label: 'Google Gemini Pro', description: 'Contexto longo, ideal para análise de dados' },
  { value: 'anthropic', label: 'Anthropic Claude', description: 'Análises profundas e detalhadas' },
  { value: 'openai', label: 'OpenAI GPT-4', description: 'Raciocínio avançado para insights' },
];

const imageProviders = [
  { value: 'lovable', label: 'Lovable AI (Padrão)', description: 'Gemini Flash Image (Básico) — incluso no plano' },
  { value: 'openai', label: 'OpenAI DALL-E 3', description: 'Qualidade fotográfica superior — requer OpenAI API Key', recommended: true },
  { value: 'gemini', label: 'Google Imagen', description: 'Imagen 3 via Gemini API — requer Google API key' },
];

export function AISettingsTab() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<AISettings>(defaultSettings);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({
    openai: false,
    gemini: false,
    anthropic: false,
  });

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setSettings(prev => ({ ...prev, ...JSON.parse(saved) }));
      } catch (e) {
        console.error('Erro ao carregar configurações:', e);
      }
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    toast({
      title: 'Configurações salvas',
      description: 'As preferências de IA foram atualizadas com sucesso.',
    });
    // Forçar recarga para sincronizar outras abas se necessário
    window.dispatchEvent(new Event('storage'));
  };

  const toggleKeyVisibility = (key: string) => {
    setShowKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-6">
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle>Provedores de IA</CardTitle>
          </div>
          <CardDescription>
            Escolha qual provedor de IA usar para cada funcionalidade. O Lovable AI já está incluso e não requer configuração.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Copy Provider */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-muted-foreground" />
              Provedor para Copies & Textos
            </Label>
            <Select
              value={settings.copyProvider}
              onValueChange={(v) => setSettings(prev => ({ ...prev, copyProvider: v }))}
            >
              <SelectTrigger className="bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {copyProviders.map(p => (
                  <SelectItem key={p.value} value={p.value}>
                    <div className="flex items-center gap-2">
                      <span>{p.label}</span>
                      {p.recommended && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Recomendado</Badge>}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {copyProviders.find(p => p.value === settings.copyProvider)?.description}
            </p>
          </div>

          {/* Analysis Provider */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Info className="h-4 w-4 text-muted-foreground" />
              Provedor para Análises (José / Insights)
            </Label>
            <Select
              value={settings.analysisProvider}
              onValueChange={(v) => setSettings(prev => ({ ...prev, analysisProvider: v }))}
            >
              <SelectTrigger className="bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {analysisProviders.map(p => (
                  <SelectItem key={p.value} value={p.value}>
                    <div className="flex items-center gap-2">
                      <span>{p.label}</span>
                      {p.recommended && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Recomendado</Badge>}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {analysisProviders.find(p => p.value === settings.analysisProvider)?.description}
            </p>
          </div>

          {/* Image Provider */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2 text-primary font-bold">
              <Image className="h-4 w-4" />
              Provedor para Imagens (Maria Designer)
            </Label>
            <Select
              value={settings.imageProvider}
              onValueChange={(v) => setSettings(prev => ({ ...prev, imageProvider: v }))}
            >
              <SelectTrigger className="bg-background/50 border-primary/30 ring-primary/20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {imageProviders.map(p => (
                  <SelectItem key={p.value} value={p.value}>
                    <div className="flex items-center gap-2">
                      <span>{p.label}</span>
                      {p.recommended && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gradient-primary text-white border-0">Avançado</Badge>}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {imageProviders.find(p => p.value === settings.imageProvider)?.description}
            </p>
          </div>

          {/* Fallback Switch */}
          <div className="flex items-center justify-between pt-4 border-t border-border/40">
            <div className="space-y-0.5">
              <Label className="text-base font-medium">Fallback Automático</Label>
              <p className="text-xs text-muted-foreground">
                Quando o provedor principal falhar (limite de uso ou créditos), usar automaticamente outro provedor disponível.
              </p>
            </div>
            <Switch
              checked={settings.autoFallback}
              onCheckedChange={(v) => setSettings(prev => ({ ...prev, autoFallback: v }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg">Configurações de API</CardTitle>
          <CardDescription>
            Insira suas chaves de API para usar provedores diretos. Suas chaves são salvas localmente no seu navegador.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="openai-key">OpenAI API Key (gpt-image-1 / GPT-4)</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="openai-key"
                  type={showKeys.openai ? 'text' : 'password'}
                  placeholder="sk-..."
                  value={settings.openaiKey}
                  onChange={(e) => setSettings(prev => ({ ...prev, openaiKey: e.target.value }))}
                  className="bg-background/50 pr-10"
                />
                <button
                  type="button"
                  onClick={() => toggleKeyVisibility('openai')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKeys.openai ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Badge variant="outline" className={`${settings.openaiKey ? 'bg-success/10 text-success border-success/30' : 'bg-muted text-muted-foreground'} whitespace-nowrap`}>
                {settings.openaiKey ? 'Configurada ✓' : 'Não configurada'}
              </Badge>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="gemini-key">Google Gemini API Key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="gemini-key"
                  type={showKeys.gemini ? 'text' : 'password'}
                  placeholder="AIza..."
                  value={settings.geminiKey}
                  onChange={(e) => setSettings(prev => ({ ...prev, geminiKey: e.target.value }))}
                  className="bg-background/50 pr-10"
                />
                <button
                  type="button"
                  onClick={() => toggleKeyVisibility('gemini')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKeys.gemini ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Badge variant="outline" className={`${settings.geminiKey ? 'bg-success/10 text-success border-success/30' : 'bg-muted text-muted-foreground'} whitespace-nowrap`}>
                {settings.geminiKey ? 'Configurada ✓' : 'Não configurada'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} className="gradient-primary text-white font-bold px-8 shadow-lg shadow-primary/20">
          <Save className="mr-2 h-4 w-4" />
          SALVAR CONFIGURAÇÕES
        </Button>
      </div>
    </div>
  );
}
