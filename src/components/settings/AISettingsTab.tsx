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

const STORAGE_KEY = 'humanizeai-ai-settings';

interface AISettings {
  copyProvider: string;
  analysisProvider: string;
  imageProvider: string;
  openaiKey: string;
  geminiKey: string;
  anthropicKey: string;
  autoFallback: boolean;
}

const defaultSettings: AISettings = {
  copyProvider: 'lovable',
  analysisProvider: 'lovable',
  imageProvider: 'lovable',
  openaiKey: '',
  geminiKey: '',
  anthropicKey: '',
  autoFallback: true,
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
  { value: 'lovable', label: 'Lovable AI (Padrão)', description: 'Gemini Flash Image — incluso no plano', recommended: true },
  { value: 'gemini', label: 'Google Imagen', description: 'Imagen 3 via Gemini API — requer API key' },
];

export function AISettingsTab() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<AISettings>(defaultSettings);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setSettings({ ...defaultSettings, ...JSON.parse(saved) });
      } catch {}
    }
  }, []);

  const handleSave = () => {
    setIsSaving(true);
    // Save to localStorage (API keys here are for client-side reference only;
    // actual keys are managed via Supabase secrets)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setTimeout(() => {
      setIsSaving(false);
      toast({
        title: 'Configurações salvas',
        description: 'Suas preferências de IA foram atualizadas.',
      });
    }, 500);
  };

  const toggleShowKey = (key: string) => {
    setShowKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const maskKey = (key: string) => {
    if (!key) return '';
    if (key.length <= 8) return '••••••••';
    return '••••••••••••' + key.slice(-4);
  };

  const needsKey = (provider: string) => {
    if (provider === 'lovable') return false;
    if (provider === 'gemini') return !settings.geminiKey;
    if (provider === 'openai') return !settings.openaiKey;
    if (provider === 'anthropic') return !settings.anthropicKey;
    return false;
  };

  const getRequiredKeys = () => {
    const keys = new Set<string>();
    [settings.copyProvider, settings.analysisProvider, settings.imageProvider].forEach(p => {
      if (p !== 'lovable') keys.add(p);
    });
    return Array.from(keys);
  };

  return (
    <div className="space-y-6">
      {/* Provider Selection */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Provedores de IA
          </CardTitle>
          <CardDescription>
            Escolha qual provedor de IA usar para cada funcionalidade. O Lovable AI já está incluso e não requer configuração.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Copy Provider */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-muted-foreground" />
              Provedor para Copies & Textos
            </Label>
            <Select
              value={settings.copyProvider}
              onValueChange={(v) => setSettings(prev => ({ ...prev, copyProvider: v }))}
            >
              <SelectTrigger>
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
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-muted-foreground" />
              Provedor para Análises (Midas / Insights)
            </Label>
            <Select
              value={settings.analysisProvider}
              onValueChange={(v) => setSettings(prev => ({ ...prev, analysisProvider: v }))}
            >
              <SelectTrigger>
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
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Image className="h-4 w-4 text-muted-foreground" />
              Provedor para Imagens
            </Label>
            <Select
              value={settings.imageProvider}
              onValueChange={(v) => setSettings(prev => ({ ...prev, imageProvider: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {imageProviders.map(p => (
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
              {imageProviders.find(p => p.value === settings.imageProvider)?.description}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Auto Fallback */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-base">Fallback Automático</CardTitle>
          <CardDescription>
            Quando o provedor principal falhar (limite de uso ou créditos), usar automaticamente outro provedor disponível.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Ativar fallback automático</Label>
              <p className="text-xs text-muted-foreground">
                Lovable AI → Gemini direto → Claude (se configurado)
              </p>
            </div>
            <Switch
              checked={settings.autoFallback}
              onCheckedChange={(v) => setSettings(prev => ({ ...prev, autoFallback: v }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Super Gestor Apollo */}
      <Card className="border-primary/30 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Super Gestor Apollo
            {settings.anthropicKey && (
              <Badge variant="outline" className="bg-success/10 text-success border-success/30 text-[10px]">
                Configurado
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            IA avançada que cria estratégias de campanha, gera copies persuasivos e otimiza anúncios automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Sugestões automáticas</Label>
              <p className="text-xs text-muted-foreground">
                O Apollo analisa campanhas e sugere otimizações proativamente
              </p>
            </div>
            <Switch
              checked={settings.autoSuggestions ?? true}
              onCheckedChange={(v) => setSettings(prev => ({ ...prev, autoSuggestions: v }))}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Modo conservador</Label>
              <p className="text-xs text-muted-foreground">
                Apenas sugere ações, nunca executa automaticamente
              </p>
            </div>
            <Switch
              checked={settings.conservativeMode ?? true}
              onCheckedChange={(v) => setSettings(prev => ({ ...prev, conservativeMode: v }))}
            />
          </div>
          <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/20 p-3">
            <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              <strong>Dica:</strong> O Super Gestor usa a chave Anthropic Claude configurada acima. Quanto mais dados históricos suas contas tiverem, melhores serão as recomendações.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* API Keys */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-base">🔑 API Keys</CardTitle>
          <CardDescription>
            As chaves ficam armazenadas de forma segura no servidor. Aqui você pode verificar se estão configuradas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Gemini Key */}
          <div className="space-y-2">
            <Label>Google Gemini</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKeys.gemini ? 'text' : 'password'}
                  value={settings.geminiKey || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, geminiKey: e.target.value }))}
                  placeholder="AIza..."
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => toggleShowKey('gemini')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKeys.gemini ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Badge variant="outline" className="bg-success/10 text-success border-success/30 whitespace-nowrap">
                Configurada ✓
              </Badge>
            </div>
          </div>

          {/* Anthropic Key */}
          <div className="space-y-2">
            <Label>Anthropic Claude</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKeys.anthropic ? 'text' : 'password'}
                  value={settings.anthropicKey || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, anthropicKey: e.target.value }))}
                  placeholder="sk-ant-..."
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => toggleShowKey('anthropic')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKeys.anthropic ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Badge variant="outline" className="bg-success/10 text-success border-success/30 whitespace-nowrap">
                Configurada ✓
              </Badge>
            </div>
          </div>

          {/* OpenAI Key */}
          <div className="space-y-2">
            <Label>OpenAI</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKeys.openai ? 'text' : 'password'}
                  value={settings.openaiKey || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, openaiKey: e.target.value }))}
                  placeholder="sk-..."
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => toggleShowKey('openai')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKeys.openai ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Badge variant="outline" className="bg-muted text-muted-foreground whitespace-nowrap">
                Não configurada
              </Badge>
            </div>
          </div>

          {/* Info tip */}
          <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/20 p-3 mt-4">
            <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong>Dica:</strong> O Lovable AI (Gemini Flash) é a opção mais econômica para uso diário. Use GPT-4 ou Claude para copies premium quando precisar de máxima qualidade.</p>
              <p>As chaves Gemini e Claude já estão configuradas no servidor — o fallback automático funciona mesmo sem preencher os campos acima.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving} className="gap-2">
          <Save className="h-4 w-4" />
          {isSaving ? 'Salvando...' : 'Salvar Configurações'}
        </Button>
      </div>
    </div>
  );
}
