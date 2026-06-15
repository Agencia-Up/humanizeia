import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Save, Image } from 'lucide-react';
import { ClientAiKeysCard } from './ClientAiKeysCard';

const STORAGE_KEY = 'logosia-ai-settings';

interface AISettings {
  imageProvider: string;
}

const defaultSettings: AISettings = {
  imageProvider: 'openai',
};

// Único provedor de imagem realmente em uso. A geração roda em OpenAI DALL-E 3
// (chave configurada no backend). Provedores antigos (Lovable / Gemini) foram
// removidos por não terem estrutura real exposta ao cliente.
const imageProviders = [
  { value: 'openai', label: 'OpenAI DALL-E 3', description: 'Qualidade fotográfica superior — gera os criativos da Maria Designer.' },
];

const ALLOWED_IMAGE_PROVIDERS = imageProviders.map((p) => p.value);

export function AISettingsTab() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<AISettings>(defaultSettings);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Migra configs antigas: qualquer provedor removido vira 'openai'.
        const imageProvider = ALLOWED_IMAGE_PROVIDERS.includes(parsed.imageProvider)
          ? parsed.imageProvider
          : 'openai';
        setSettings({ imageProvider });
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
    window.dispatchEvent(new Event('storage'));
  };

  return (
    <div className="space-y-6">
      {/* BYOK — traga sua chave de IA (conversas ilimitadas por conta do cliente) */}
      <ClientAiKeysCard />

      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Image className="h-5 w-5 text-primary" />
            <CardTitle>Provedor de Imagens</CardTitle>
          </div>
          <CardDescription>
            Define qual IA gera os criativos visuais da Maria Designer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Label className="flex items-center gap-2 text-primary font-bold">
              <Image className="h-4 w-4" />
              Geração de imagens (Maria Designer)
            </Label>
            <Select
              value={settings.imageProvider}
              onValueChange={(v) => setSettings({ imageProvider: v })}
            >
              <SelectTrigger className="bg-background/50 border-primary/30 ring-primary/20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {imageProviders.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    <span>{p.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {imageProviders.find((p) => p.value === settings.imageProvider)?.description}
            </p>
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
