import { useState, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import { 
  Sparkles, 
  Copy, 
  Star, 
  BookmarkPlus, 
  RefreshCw, 
  Edit3,
  History,
  BookOpen,
  FileText,
  Check,
  X,
  Pencil,
  Save,
  Plus,
  Trash2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { StudioHeader, type StudioTab } from '@/components/layout/StudioHeader';
import { CopyResult, mockCopyTemplates } from '@/data/mockData';
import { SwipeFileTab } from '@/components/copywriter/SwipeFileTab';
import { SaveToSwipeFileDialog } from '@/components/copywriter/SaveToSwipeFileDialog';
import { useSwipeFiles } from '@/hooks/useSwipeFiles';
import { useCopyFormulas } from '@/hooks/useCopyFormulas';

const platforms = [
  { value: 'meta', label: 'Meta Ads' },
  { value: 'google', label: 'Google Ads' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

const metaAdTypes = [
  { value: 'feed', label: 'Feed' },
  { value: 'stories', label: 'Stories' },
  { value: 'reels', label: 'Reels' },
  { value: 'carousel', label: 'Carousel' },
];

const googleAdTypes = [
  { value: 'search', label: 'Search (RSA)' },
  { value: 'display', label: 'Display' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'pmax', label: 'Performance Max' },
  { value: 'demandgen', label: 'Demand Gen' },
];

const whatsappAdTypes = [
  { value: 'cold_outreach', label: 'Prospecção Fria' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'reactivation', label: 'Reativação de Lead' },
  { value: 'offer', label: 'Oferta / Promoção' },
  { value: 'nurturing', label: 'Nutrição de Lead' },
];

const tones = [
  { value: 'professional', label: 'Profissional' },
  { value: 'casual', label: 'Casual' },
  { value: 'urgent', label: 'Urgente' },
  { value: 'emotional', label: 'Emocional' },
  { value: 'educational', label: 'Educativo' },
  { value: 'provocative', label: 'Provocativo' },
  { value: 'humorous', label: 'Humorístico' },
];

const objectives = [
  { value: 'conversion', label: 'Conversão' },
  { value: 'traffic', label: 'Tráfego' },
  { value: 'awareness', label: 'Awareness' },
  { value: 'engagement', label: 'Engajamento' },
  { value: 'leads', label: 'Leads' },
];

const mentalTriggers = [
  { value: 'scarcity', label: '⏰ Escassez', desc: 'Últimas unidades, tempo limitado' },
  { value: 'social_proof', label: '👥 Prova Social', desc: 'Milhares já usam, depoimentos' },
  { value: 'authority', label: '🏆 Autoridade', desc: 'Especialistas recomendam, líder do mercado' },
  { value: 'reciprocity', label: '🎁 Reciprocidade', desc: 'Bônus grátis, materiais extras' },
  { value: 'curiosity', label: '🔍 Curiosidade', desc: 'Segredos revelados, descubra como' },
  { value: 'fear_of_loss', label: '😰 Medo de Perder', desc: 'FOMO, oportunidade única' },
  { value: 'exclusivity', label: '👑 Exclusividade', desc: 'Apenas para membros, acesso VIP' },
  { value: 'transformation', label: '🔄 Transformação', desc: 'Antes/depois, mudança de vida' },
];

export default function AICopywriter() {
  const { toast } = useToast();
  const [platform, setPlatform] = useState('meta');
  const [adType, setAdType] = useState('feed');
  const [product, setProduct] = useState('');
  const [description, setDescription] = useState('');
  const [tone, setTone] = useState('professional');
  const [objective, setObjective] = useState('conversion');
  const [includeEmojis, setIncludeEmojis] = useState(true);
  const [includeCTA, setIncludeCTA] = useState(true);
  const [creativity, setCreativity] = useState([5]);
  const [variations, setVariations] = useState(3);
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState<CopyResult[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [isImproving, setIsImproving] = useState(false);
  const { swipeFiles, addSwipeFile, updateSwipeFile } = useSwipeFiles();
  const { formulas: dbFormulas, addFormula, deleteFormula, loading: formulasLoading } = useCopyFormulas();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveDialogData, setSaveDialogData] = useState<{ title: string; content: string } | null>(null);
  const [variationLoading, setVariationLoading] = useState<string | null>(null);
  const [variationResults, setVariationResults] = useState<Record<string, CopyResult>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ title: string; content: string; notes: string }>({ title: '', content: '', notes: '' });
  const [selectedFormula, setSelectedFormula] = useState<string | null>(null);
  const [selectedTriggers, setSelectedTriggers] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState('generate');
  const [showFormulaForm, setShowFormulaForm] = useState(false);
  const [newFormula, setNewFormula] = useState({ name: '', full_name: '', description: '', example: '' });

  const adTypes = platform === 'meta' ? metaAdTypes : platform === 'whatsapp' ? whatsappAdTypes : googleAdTypes;

  const { sendSingleMessage } = useClaudeChat({
    context: 'copywriter',
    onDelta: (delta) => {
      setStreamingContent(prev => prev + delta);
    },
    onError: (error) => {
      toast({
        title: 'Erro ao gerar copies',
        description: error,
        variant: 'destructive',
      });
    }
  });

  const { sendSingleMessage: sendImproveMessage } = useClaudeChat({
    context: 'assistant',
  });

  const isDescriptionEmpty = !description.trim();

  const handleImproveDescription = useCallback(async () => {
    if (!product.trim()) {
      toast({
        title: 'Produto obrigatório',
        description: 'Preencha o nome do produto para gerar ou melhorar a descrição.',
        variant: 'destructive',
      });
      return;
    }

    const generating = !description.trim();
    setIsImproving(true);
    try {
      const prompt = generating
        ? `Crie uma descrição curta e objetiva do produto "${product.trim()}" para que um copywriter entenda o que é o produto. Descreva o que é, para quem serve, principais características e diferenciais. NÃO escreva uma copy de anúncio. Retorne APENAS a descrição do produto em 2-4 frases, sem títulos ou explicações.`
        : `Reescreva esta descrição de produto tornando-a mais clara, completa e informativa. Mantenha como uma descrição do produto (NÃO uma copy de anúncio). Foque em: o que é, para quem serve, benefícios e diferenciais. Retorne APENAS o texto melhorado, sem explicações.\n\nProduto: ${product.trim()}\nDescrição atual:\n${description}`;
      const response = await sendImproveMessage(prompt);
      if (response?.trim()) {
        const cleaned = response
          .replace(/```[\s\S]*?```/g, '')
          .replace(/^[*-]\s+/gm, '')
          .replace(/#+\s+/g, '')
          .replace(/\*\*(.*?)\*\*/g, '$1')
          .replace(/_(.*?)_/g, '$1')
          .replace(/`([^`]+)`/g, '$1')
          .trim();
        setDescription(cleaned);
        toast({
          title: generating ? '✨ Descrição gerada!' : '✨ Descrição melhorada!',
          description: generating ? 'A descrição foi criada pela IA.' : 'A descrição foi reescrita pela IA.',
        });
      }
    } catch (error) {
      console.error('Improve description error:', error);
      toast({
        title: 'Erro ao processar descrição',
        description: 'Não foi possível processar a descrição. Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setIsImproving(false);
    }
  }, [product, description, sendImproveMessage, toast]);

  const handleGenerate = useCallback(async () => {
    if (!product || !description) {
      toast({
        title: 'Campos obrigatórios',
        description: 'Preencha o produto e a descrição para gerar copies.',
        variant: 'destructive',
      });
      return;
    }

    setIsGenerating(true);
    setResults([]);
    setStreamingContent('');

    // Get selected formula details from DB
    const selectedFormulaData = dbFormulas.find(f => f.id === selectedFormula);
    const formulaContext = selectedFormula && selectedFormulaData
      ? { fullName: selectedFormulaData.full_name, description: selectedFormulaData.description, example: selectedFormulaData.example }
      : null;

    const whatsappContext = platform === 'whatsapp'
      ? `\n\nCONTEXTO WHATSAPP: Esta copy será usada para disparo em massa via WhatsApp para prospecção de leads frios.
Tipo: ${adTypes.find(t => t.value === adType)?.label || adType}
REGRAS IMPORTANTES para WhatsApp:
- Mensagens curtas e diretas (máx 500 caracteres por variação)
- Linguagem pessoal e humanizada, como se fosse uma conversa 1-a-1
- NÃO use formatações de anúncio (sem headline separada)
- Use quebras de linha para facilitar leitura no celular
- O "headline" no JSON deve ser a primeira frase de abertura (gancho)
- O "description" deve ser o corpo completo da mensagem
- O "cta" deve ser uma frase de ação conversacional (ex: "Posso te enviar mais detalhes?")
- Evite parecer spam ou mensagem genérica de marketing
- Cada variação deve ser significativamente diferente das outras`
      : '';

    const prompt = `Gere ${variations} variações de copy para ${platform === 'whatsapp' ? 'mensagem de WhatsApp' : 'anúncio'}.
    
Produto: ${product}
Descrição: ${description}
Tom: ${tone}
Objetivo: ${objective}
Incluir emojis: ${includeEmojis ? 'sim, com moderação' : 'não'}
Incluir CTA: ${includeCTA ? 'sim' : 'não'}
Criatividade: ${creativity[0]}/10${whatsappContext}${selectedTriggers.length > 0 ? `\nGatilhos mentais obrigatórios: ${selectedTriggers.map(t => mentalTriggers.find(mt => mt.value === t)?.label || t).join(', ')}. Use esses gatilhos de forma natural no texto.` : ''}${formulaContext ? `\nFórmula de Copy: ${formulaContext.fullName}\nDescrição da fórmula: ${formulaContext.description}\nEstrutura: ${formulaContext.example.replace(/\n/g, ' | ')}` : ''}`;

    // Build swipe file context for the AI
    const swipeFileExamples = swipeFiles
      .filter(f => f.is_favorite || swipeFiles.length <= 5)
      .slice(0, 5)
      .map(f => `[${f.title}] (${f.category}/${f.platform}):\n${f.content}`)
      .join('\n\n---\n\n');

    try {
      const response = await sendSingleMessage(prompt, {
        platform,
        adType,
        tone,
        objective,
        includeEmojis,
        includeCTA,
        creativity: creativity[0],
        variations,
        product,
        description,
        swipeFileExamples: swipeFileExamples || undefined,
      });

      // Parse the JSON response (a IA às vezes envolve em ```json ... ```)
      const extractJsonObject = (raw: string) => {
        let text = raw.trim();

        // Remove markdown fenced code blocks
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (fenced?.[1]) text = fenced[1].trim();

        // Extract first JSON object found
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
          text = text.slice(start, end + 1);
        }

        return JSON.parse(text);
      };

      try {
        const parsed = extractJsonObject(response);
        if (parsed.copies && Array.isArray(parsed.copies)) {
          const formattedResults: CopyResult[] = parsed.copies.map((copy: any, index: number) => ({
            id: `${Date.now()}-${index}`,
            headline: copy.headline || '',
            description: copy.description || '',
            cta: copy.cta || 'Saiba Mais',
            platform: platform,
            score: copy.score || Math.floor(Math.random() * 20) + 80,
            headlineChars: (copy.headline || '').length,
            descriptionChars: (copy.description || '').length,
          }));
          setResults(formattedResults);

          // Auto-save each copy to swipe file history
          for (const copy of formattedResults) {
            const content = [
              copy.headline && `📌 ${copy.headline}`,
              copy.description,
              copy.cta && `🔗 ${copy.cta}`,
            ].filter(Boolean).join('\n\n');

            addSwipeFile({
              title: copy.headline || `Copy ${product}`,
              content,
              category: 'geral',
              platform,
              notes: `Gerada por IA • Score: ${copy.score} • Produto: ${product}`,
              source: 'auto',
            });
          }

          toast({
            title: '✨ Copies geradas e salvas!',
            description: `${formattedResults.length} variações criadas e adicionadas ao histórico.`,
          });
        }
      } catch {
        toast({
          title: 'Resposta recebida',
          description: 'Recebi conteúdo da IA, mas o formato não foi reconhecido. Tente reduzir o nº de variações ou re-gerar.',
        });
      }
    } catch (error) {
      console.error('Generation error:', error);
    } finally {
      setIsGenerating(false);
      setStreamingContent('');
    }
  }, [product, description, platform, adType, tone, objective, includeEmojis, includeCTA, creativity, variations, selectedFormula, dbFormulas, sendSingleMessage, toast, addSwipeFile]);

  const toggleFavorite = (id: string) => {
    setFavorites((prev) =>
      prev.includes(id) ? prev.filter((fid) => fid !== id) : [...prev, id]
    );
  };

  const handleGenerateVariation = useCallback(async (result: CopyResult) => {
    setVariationLoading(result.id);
    try {
      const prompt = `Crie UMA variação alternativa desta copy de anúncio, mantendo a mesma intenção mas com abordagem diferente.

Copy original:
Headline: ${result.headline}
Descrição: ${result.description}
CTA: ${result.cta}

Produto: ${product}
Tom: ${tone}
Objetivo: ${objective}

Retorne APENAS um JSON no formato: {"headline": "...", "description": "...", "cta": "...", "score": 85}`;

      const response = await sendImproveMessage(prompt);
      if (response?.trim()) {
        let text = response.trim();
        const fenced = text.match(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/i);
        if (fenced?.[1]) text = fenced[1].trim();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1) text = text.slice(start, end + 1);

        const parsed = JSON.parse(text);
        const variation: CopyResult = {
          id: `var-${result.id}`,
          headline: parsed.headline || '',
          description: parsed.description || '',
          cta: parsed.cta || 'Saiba Mais',
          platform: result.platform,
          score: parsed.score || Math.floor(Math.random() * 20) + 80,
          headlineChars: (parsed.headline || '').length,
          descriptionChars: (parsed.description || '').length,
        };
        setVariationResults(prev => ({ ...prev, [result.id]: variation }));
      }
    } catch (error) {
      console.error('Variation error:', error);
      toast({
        title: 'Erro ao gerar variação',
        description: 'Não foi possível gerar a variação. Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setVariationLoading(null);
    }
  }, [product, tone, objective, sendImproveMessage, toast]);

  const acceptVariation = useCallback((originalId: string) => {
    const variation = variationResults[originalId];
    if (variation) {
      setResults(prev => prev.map(r => r.id === originalId ? { ...variation, id: originalId } : r));
      setVariationResults(prev => {
        const next = { ...prev };
        delete next[originalId];
        return next;
      });
      toast({ title: '✅ Variação aceita!' });
    }
  }, [variationResults, toast]);

  const declineVariation = useCallback((originalId: string) => {
    setVariationResults(prev => {
      const next = { ...prev };
      delete next[originalId];
      return next;
    });
  }, []);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copiado!',
      description: 'Texto copiado para a área de transferência.',
    });
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'bg-success text-success-foreground';
    if (score >= 70) return 'bg-primary text-primary-foreground';
    if (score >= 50) return 'bg-warning text-warning-foreground';
    return 'bg-destructive text-destructive-foreground';
  };

  const getCharCountColor = (current: number, max: number) => {
    const ratio = current / max;
    if (ratio <= 0.8) return 'text-success';
    if (ratio <= 1) return 'text-warning';
    return 'text-destructive';
  };

  return (
    <MainLayout>
      <div className="space-y-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <StudioHeader
            icon={Edit3}
            title="AI Copywriter"
            tabs={[
              { value: 'generate', label: 'Gerar', icon: Sparkles },
              { value: 'history', label: 'Histórico', icon: History },
              { value: 'formulas', label: 'Fórmulas', icon: BookOpen },
              { value: 'swipefile', label: 'Swipe File', icon: FileText },
            ]}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />

          <TabsContent value="generate" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-5">
              {/* Form Column */}
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-lg">Configuração</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Plataforma</Label>
                      <Select value={platform} onValueChange={setPlatform}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {platforms.map((p) => (
                            <SelectItem key={p.value} value={p.value}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Tipo de Anúncio</Label>
                      <Select value={adType} onValueChange={setAdType}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {adTypes.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Produto/Serviço</Label>
                    <Input
                      value={product}
                      onChange={(e) => setProduct(e.target.value)}
                      placeholder="Ex: Curso de Marketing Digital"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Descrição do Produto</Label>
                    <Textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Descreva seu produto, benefícios, diferenciais..."
                      rows={3}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={handleImproveDescription}
                      disabled={isImproving || !product.trim()}
                    >
                      {isImproving ? (
                        <>
                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                          {isDescriptionEmpty ? 'Gerando...' : 'Melhorando...'}
                        </>
                      ) : (
                        <>
                          <Sparkles className="mr-2 h-4 w-4" />
                          {isDescriptionEmpty ? 'Gerar com IA' : 'Melhorar com IA'}
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Tom de Voz</Label>
                      <Select value={tone} onValueChange={setTone}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {tones.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Objetivo</Label>
                      <Select value={objective} onValueChange={setObjective}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {objectives.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Nível de Criatividade: {creativity[0]}</Label>
                    <Slider
                      value={creativity}
                      onValueChange={setCreativity}
                      min={1}
                      max={10}
                      step={1}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Variações: {variations}</Label>
                    <Slider
                      value={[variations]}
                      onValueChange={(v) => setVariations(v[0])}
                      min={1}
                      max={10}
                      step={1}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>Incluir Emojis</Label>
                    <Switch checked={includeEmojis} onCheckedChange={setIncludeEmojis} />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>Incluir CTA</Label>
                    <Switch checked={includeCTA} onCheckedChange={setIncludeCTA} />
                  </div>

                  {/* Mental Triggers */}
                  <div className="space-y-2">
                    <Label>Gatilhos Mentais</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {mentalTriggers.map((trigger) => {
                        const isSelected = selectedTriggers.includes(trigger.value);
                        return (
                          <button
                            key={trigger.value}
                            onClick={() => setSelectedTriggers(prev =>
                              isSelected ? prev.filter(t => t !== trigger.value) : [...prev, trigger.value]
                            )}
                            className={`rounded-full px-2.5 py-1 text-xs transition-colors border ${
                              isSelected
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-muted/50 text-muted-foreground border-border/50 hover:border-primary/50 hover:text-foreground'
                            }`}
                            title={trigger.desc}
                          >
                            {trigger.label}
                          </button>
                        );
                      })}
                    </div>
                    {selectedTriggers.length > 0 && (
                      <p className="text-[10px] text-muted-foreground">
                        {selectedTriggers.length} gatilho(s) selecionado(s) — serão integrados na copy
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Fórmula de Copy</Label>
                    <Select
                      value={selectedFormula || 'none'}
                      onValueChange={(v) => setSelectedFormula(v === 'none' ? null : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Sem fórmula (livre)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sem fórmula (livre)</SelectItem>
                        {dbFormulas.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.name} — {f.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    className="w-full gradient-primary"
                    size="lg"
                    onClick={handleGenerate}
                    disabled={isGenerating}
                  >
                    {isGenerating ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        Gerando...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Gerar Copies
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Results Column */}
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm lg:col-span-3">
                <CardHeader>
                  <CardTitle className="text-lg">Resultados</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[600px] pr-4">
                    <AnimatePresence mode="wait">
                      {isGenerating ? (
                        <div className="space-y-4">
                          {Array.from({ length: variations }).map((_, i) => (
                            <div key={i} className="space-y-3 rounded-lg border border-border/50 p-4">
                              <Skeleton className="h-6 w-3/4" />
                              <Skeleton className="h-20 w-full" />
                              <div className="flex gap-2">
                                <Skeleton className="h-8 w-20" />
                                <Skeleton className="h-8 w-20" />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : results.length > 0 ? (
                        <div className="space-y-4">
                          {results.map((result, index) => (
                            <motion.div
                              key={result.id}
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: index * 0.1 }}
                              className="space-y-3 rounded-lg border border-border/50 bg-muted/20 p-4"
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex items-center gap-2">
                                  <Badge
                                    variant="secondary"
                                    className={
                                      result.platform === 'meta'
                                        ? 'bg-blue-500/20 text-blue-400'
                                        : 'bg-red-500/20 text-red-400'
                                    }
                                  >
                                    {result.platform === 'meta' ? 'Meta' : 'Google'}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">
                                    Variação {index + 1}
                                  </span>
                                </div>
                                <Badge className={getScoreColor(result.score)}>
                                  Score: {result.score}
                                </Badge>
                              </div>

                              <div className="space-y-2">
                                {editingId === result.id ? (
                                  <>
                                    <div>
                                      <span className="text-sm font-medium">Headline</span>
                                      <Input
                                        value={editForm.title}
                                        onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                                      />
                                    </div>
                                    <div>
                                      <span className="text-sm font-medium">Descrição</span>
                                      <Textarea
                                        value={editForm.content}
                                        onChange={(e) => setEditForm(prev => ({ ...prev, content: e.target.value }))}
                                        rows={4}
                                      />
                                    </div>
                                    <div>
                                      <span className="text-sm font-medium">CTA</span>
                                      <Input
                                        value={editForm.notes}
                                        onChange={(e) => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                                      />
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div>
                                      <div className="flex items-center justify-between text-sm">
                                        <span className="font-medium">Headline</span>
                                        <span className={`text-xs ${getCharCountColor(result.headlineChars, 40)}`}>
                                          {result.headlineChars}/40 caracteres
                                        </span>
                                      </div>
                                      <p className="text-lg font-semibold">{result.headline}</p>
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between text-sm">
                                        <span className="font-medium">Descrição</span>
                                        <span className={`text-xs ${getCharCountColor(result.descriptionChars, 200)}`}>
                                          {result.descriptionChars}/200 caracteres
                                        </span>
                                      </div>
                                      <p className="text-muted-foreground">{result.description}</p>
                                    </div>
                                    <div>
                                      <span className="text-sm font-medium">CTA:</span>{' '}
                                      <Badge variant="outline">{result.cta}</Badge>
                                    </div>
                                  </>
                                )}
                              </div>

                              <div className="flex flex-wrap gap-2">
                                {editingId === result.id ? (
                                  <>
                                    <Button size="sm" onClick={() => {
                                      setResults(prev => prev.map(r => r.id === result.id ? {
                                        ...r,
                                        headline: editForm.title,
                                        description: editForm.content,
                                        cta: editForm.notes,
                                        headlineChars: editForm.title.length,
                                        descriptionChars: editForm.content.length,
                                      } : r));
                                      setEditingId(null);
                                      toast({ title: '✅ Copy atualizada!' });
                                    }}>
                                      <Save className="mr-2 h-3 w-3" />
                                      Salvar
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                                      <X className="mr-2 h-3 w-3" />
                                      Cancelar
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    copyToClipboard(`${result.headline}\n\n${result.description}`)
                                  }
                                >
                                  <Copy className="mr-2 h-3 w-3" />
                                  Copiar
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => {
                                  setEditingId(result.id);
                                  setEditForm({ title: result.headline, content: result.description, notes: result.cta });
                                }}>
                                  <Edit3 className="mr-2 h-3 w-3" />
                                  Editar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setSaveDialogData({
                                      title: result.headline || `Copy ${index + 1}`,
                                      content: `${result.headline}\n\n${result.description}${result.cta ? `\n\nCTA: ${result.cta}` : ''}`,
                                    });
                                    setSaveDialogOpen(true);
                                  }}
                                >
                                  <BookmarkPlus className="mr-2 h-3 w-3" />
                                  Salvar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleGenerateVariation(result)}
                                  disabled={variationLoading === result.id}
                                >
                                  {variationLoading === result.id ? (
                                    <RefreshCw className="mr-2 h-3 w-3 animate-spin" />
                                  ) : (
                                    <RefreshCw className="mr-2 h-3 w-3" />
                                  )}
                                  Variação
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => toggleFavorite(result.id)}
                                  className={favorites.includes(result.id) ? 'text-yellow-500' : ''}
                                >
                                  <Star
                                    className={`mr-2 h-3 w-3 ${
                                      favorites.includes(result.id) ? 'fill-current' : ''
                                    }`}
                                  />
                                  Favorito
                                </Button>
                                  </>
                                )}
                              </div>

                              {/* Variation Preview */}
                              {variationResults[result.id] && (
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: 'auto' }}
                                  exit={{ opacity: 0, height: 0 }}
                                  className="mt-3 space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-4"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-primary">Nova Variação</span>
                                    <Badge className={getScoreColor(variationResults[result.id].score)}>
                                      Score: {variationResults[result.id].score}
                                    </Badge>
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-sm font-medium">Headline</p>
                                    <p className="font-semibold">{variationResults[result.id].headline}</p>
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-sm font-medium">Descrição</p>
                                    <p className="text-sm text-muted-foreground">{variationResults[result.id].description}</p>
                                  </div>
                                  <div>
                                    <span className="text-sm font-medium">CTA:</span>{' '}
                                    <Badge variant="outline">{variationResults[result.id].cta}</Badge>
                                  </div>
                                  <div className="flex gap-2 pt-1">
                                    <Button
                                      size="sm"
                                      variant="default"
                                      className="gap-1"
                                      onClick={() => acceptVariation(result.id)}
                                    >
                                      <Check className="h-3 w-3" />
                                      Aceitar
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="gap-1"
                                      onClick={() => declineVariation(result.id)}
                                    >
                                      <X className="h-3 w-3" />
                                      Descartar
                                    </Button>
                                  </div>
                                </motion.div>
                              )}
                            </motion.div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center py-20 text-center">
                          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                            <Sparkles className="h-8 w-8 text-muted-foreground" />
                          </div>
                          <h3 className="mt-4 font-semibold">Nenhuma copy gerada ainda</h3>
                          <p className="mt-2 text-sm text-muted-foreground">
                            Preencha o formulário e clique em "Gerar Copies"
                          </p>
                        </div>
                      )}
                    </AnimatePresence>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            {/* Templates Section */}
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg">Templates por Categoria</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  {mockCopyTemplates.map((template) => (
                    <Card
                      key={template.id}
                      className="cursor-pointer border-border/50 transition-all hover:border-primary/50 hover:shadow-lg"
                    >
                      <CardContent className="p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <Badge variant="secondary" className="capitalize">
                            {template.category}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={
                              template.platform === 'meta'
                                ? 'border-blue-500/50 text-blue-400'
                                : 'border-red-500/50 text-red-400'
                            }
                          >
                            {template.platform}
                          </Badge>
                        </div>
                        <h4 className="mb-2 font-medium">{template.name}</h4>
                        <p className="text-sm text-muted-foreground">{template.headline}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            {swipeFiles.filter(f => f.source === 'auto').length > 0 ? (
              <ScrollArea className="h-[600px]">
                <div className="space-y-4 pr-4">
                  <AnimatePresence>
                    {swipeFiles.filter(f => f.source === 'auto').map((file, index) => (
                      <motion.div
                        key={file.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                      >
                        <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/30 transition-all">
                          <CardContent className="p-4 space-y-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2 flex-wrap flex-1">
                                {editingId === file.id ? (
                                  <Input
                                    value={editForm.title}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                                    className="text-sm font-semibold"
                                  />
                                ) : (
                                  <h4 className="font-semibold">{file.title}</h4>
                                )}
                                {file.is_favorite && (
                                  <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                                )}
                              </div>
                              <Badge variant="secondary" className="text-xs ml-2">
                                {file.platform}
                              </Badge>
                            </div>
                            {editingId === file.id ? (
                              <Textarea
                                value={editForm.content}
                                onChange={(e) => setEditForm(prev => ({ ...prev, content: e.target.value }))}
                                rows={6}
                                className="text-sm"
                              />
                            ) : (
                              <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed line-clamp-4">
                                {file.content}
                              </p>
                            )}
                            {editingId === file.id ? (
                              <div className="space-y-1">
                                <Label className="text-xs">Notas</Label>
                                <Textarea
                                  value={editForm.notes}
                                  onChange={(e) => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                                  rows={2}
                                  className="text-sm"
                                  placeholder="Notas opcionais..."
                                />
                              </div>
                            ) : (
                              file.notes && (
                                <p className="text-xs text-muted-foreground italic">📝 {file.notes}</p>
                              )
                            )}
                            <div className="flex items-center gap-2 pt-1">
                              {editingId === file.id ? (
                                <>
                                  <Button size="sm" className="gradient-primary" onClick={async () => {
                                    await updateSwipeFile(file.id, {
                                      title: editForm.title,
                                      content: editForm.content,
                                      notes: editForm.notes || null,
                                    });
                                    setEditingId(null);
                                  }}>
                                    <Save className="mr-1 h-3 w-3" />
                                    Salvar
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                                    <X className="mr-1 h-3 w-3" />
                                    Cancelar
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button size="sm" variant="outline" onClick={() => {
                                    setEditingId(file.id);
                                    setEditForm({ title: file.title, content: file.content, notes: file.notes || '' });
                                  }}>
                                    <Pencil className="mr-1 h-3 w-3" />
                                    Editar
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => copyToClipboard(file.content)}>
                                    <Copy className="mr-1 h-3 w-3" />
                                    Copiar
                                  </Button>
                                </>
                              )}
                              <span className="ml-auto text-xs text-muted-foreground">
                                {new Date(file.created_at).toLocaleDateString('pt-BR')}
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </ScrollArea>
            ) : (
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardContent className="flex h-96 items-center justify-center">
                  <div className="text-center">
                    <History className="mx-auto h-12 w-12 text-muted-foreground" />
                    <h3 className="mt-4 font-semibold">Histórico de Copies</h3>
                    <p className="text-sm text-muted-foreground">
                      Suas copies geradas aparecerão aqui automaticamente
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="formulas" className="space-y-6">
            {/* Add Formula Button */}
            <div className="flex justify-end">
              <Button
                variant={showFormulaForm ? 'secondary' : 'default'}
                onClick={() => setShowFormulaForm(!showFormulaForm)}
                className="gap-2"
              >
                {showFormulaForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {showFormulaForm ? 'Cancelar' : 'Nova Fórmula'}
              </Button>
            </div>

            {/* Create Formula Form */}
            {showFormulaForm && (
              <Card className="border-primary/30 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Criar Nova Fórmula</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Sigla / Nome curto</Label>
                      <Input
                        placeholder="Ex: AIDA, PAS, FAB"
                        value={newFormula.name}
                        onChange={e => setNewFormula(prev => ({ ...prev, name: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Nome completo</Label>
                      <Input
                        placeholder="Ex: Atenção, Interesse, Desejo, Ação"
                        value={newFormula.full_name}
                        onChange={e => setNewFormula(prev => ({ ...prev, full_name: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Descrição</Label>
                    <Textarea
                      placeholder="Descreva como a fórmula funciona e quando usar..."
                      value={newFormula.description}
                      onChange={e => setNewFormula(prev => ({ ...prev, description: e.target.value }))}
                      rows={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Exemplo</Label>
                    <Textarea
                      placeholder="Exemplo prático da fórmula aplicada..."
                      value={newFormula.example}
                      onChange={e => setNewFormula(prev => ({ ...prev, example: e.target.value }))}
                      rows={4}
                    />
                  </div>
                  <Button
                    className="w-full"
                    disabled={!newFormula.name.trim() || !newFormula.full_name.trim() || !newFormula.description.trim()}
                    onClick={async () => {
                      await addFormula(newFormula);
                      setNewFormula({ name: '', full_name: '', description: '', example: '' });
                      setShowFormulaForm(false);
                    }}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Salvar Fórmula
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Formulas Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {formulasLoading ? (
                <>
                  <Skeleton className="h-64" />
                  <Skeleton className="h-64" />
                  <Skeleton className="h-64" />
                </>
              ) : dbFormulas.length === 0 ? (
                <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
                  <BookOpen className="h-12 w-12 text-muted-foreground" />
                  <h3 className="mt-4 font-semibold">Nenhuma fórmula ainda</h3>
                  <p className="text-sm text-muted-foreground">Crie sua primeira fórmula de copywriting</p>
                </div>
              ) : (
                dbFormulas.map((formula) => (
                  <Card key={formula.id} className="border-border/50 bg-card/50 backdrop-blur-sm">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Badge className={formula.is_default ? 'gradient-primary' : ''}
                          variant={formula.is_default ? 'default' : 'secondary'}>
                          {formula.name}
                        </Badge>
                        <span className="text-base font-normal text-muted-foreground">
                          {formula.full_name}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="ml-auto h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteFormula(formula.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm text-muted-foreground">{formula.description?.replace(/\\n/g, '\n')}</p>
                      {formula.example && (
                        <div className="rounded-lg bg-muted/50 p-3">
                          <p className="text-xs font-medium">Exemplo:</p>
                          <p className="mt-1 text-sm whitespace-pre-line">{formula.example.replace(/\\n/g, '\n')}</p>
                        </div>
                      )}
                      <Button 
                        variant="outline" 
                        className="w-full"
                        onClick={() => {
                          setSelectedFormula(formula.id);
                          setActiveTab('generate');
                        }}
                      >
                        Usar esta fórmula
                      </Button>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="swipefile">
            <SwipeFileTab />
          </TabsContent>
        </Tabs>

        {saveDialogData && (
          <SaveToSwipeFileDialog
            open={saveDialogOpen}
            onOpenChange={setSaveDialogOpen}
            title={saveDialogData.title}
            content={saveDialogData.content}
            platform={platform}
            onSave={addSwipeFile}
          />
        )}
      </div>
    </MainLayout>
  );
}
