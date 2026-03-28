import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import {
  Wand2, Brain, Target, Palette, Upload, Loader2, Sparkles,
  CheckCircle2, X, Zap, TrendingUp, Eye, AlertCircle, Camera,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BrandKit {
  clientName: string;
  produto: string;
  publico: string;
  colors: string[];
  brandStyle: string;
}

interface PromptVariation {
  nome: string;
  prompt: string;
  style: string;
  format: string;
  colors: string[];
  rationale: string;
}

export interface ApplyConfig {
  prompt: string;
  style: string;
  format: string;
  colors: string[];
  headline?: string;
  ctaText?: string;
}

type DesignObjective = 'conversao' | 'branding' | 'conteudo';

// ─── Constants ────────────────────────────────────────────────────────────────

const DESIGN_OBJECTIVES = [
  {
    value: 'conversao' as const,
    label: 'Conversão',
    emoji: '🎯',
    desc: 'Foco no produto/oferta para venda direta',
    colorClass: 'text-orange-400',
    idleCls: 'bg-orange-500/10 border-orange-500/30',
    activeCls: 'bg-orange-500/20 border-orange-500/60',
  },
  {
    value: 'branding' as const,
    label: 'Branding',
    emoji: '✨',
    desc: 'Foco na estética e emoção para construir marca',
    colorClass: 'text-violet-400',
    idleCls: 'bg-violet-500/10 border-violet-500/30',
    activeCls: 'bg-violet-500/20 border-violet-500/60',
  },
  {
    value: 'conteudo' as const,
    label: 'Conteúdo',
    emoji: '📊',
    desc: 'Foco em informação e educação para carrossel',
    colorClass: 'text-sky-400',
    idleCls: 'bg-sky-500/10 border-sky-500/30',
    activeCls: 'bg-sky-500/20 border-sky-500/60',
  },
] as const;

const VARIATION_LABELS = [
  { emoji: '🔥', name: 'Impacto Visual',        accent: 'text-orange-400', card: 'border-orange-500/30 bg-orange-500/5',  badge: 'border-orange-500/40 text-orange-400 bg-orange-500/10' },
  { emoji: '💎', name: 'Elegância Estratégica', accent: 'text-violet-400', card: 'border-violet-500/30 bg-violet-500/5',  badge: 'border-violet-500/40 text-violet-400 bg-violet-500/10' },
  { emoji: '❤️', name: 'Conexão Emocional',     accent: 'text-pink-400',   card: 'border-pink-500/30   bg-pink-500/5',    badge: 'border-pink-500/40   text-pink-400   bg-pink-500/10'   },
];

const FORMAT_LABELS: Record<string, string> = {
  'feed-1x1': 'Feed 1:1',
  'feed-4x5': 'Feed 4:5',
  'stories-9x16': 'Stories',
  'reels-9x16': 'Reels',
  'landscape-16x9': 'Landscape',
  'display-300x250': '300×250',
  'display-728x90': 'Leaderboard',
};

// ─── Internal Prompt Builder ──────────────────────────────────────────────────

function buildSystemInstructions(
  brandKit: BrandKit | null,
  objective: DesignObjective,
  danielStrategy: string,
  pauloHeadline: string,
  pauloCta: string,
  format: string,
): string {
  const objLabel =
    objective === 'conversao' ? 'Conversão — venda direta, foco no produto e oferta' :
    objective === 'branding'  ? 'Branding — construção de marca, estética e emoção' :
                                'Conteúdo — educação, informação, carrossel';

  const formatFull: Record<string, string> = {
    'feed-1x1':        'Square 1:1 — 1080×1080px, Instagram/Facebook Feed',
    'feed-4x5':        'Portrait 4:5 — 1080×1350px, Instagram Feed (mais espaço vertical)',
    'stories-9x16':    'Vertical 9:16 — 1080×1920px, Instagram/TikTok Stories',
    'reels-9x16':      'Vertical 9:16 — 1080×1920px, Reels/TikTok cover thumbnail',
    'landscape-16x9':  'Landscape 16:9 — 1920×1080px, YouTube thumbnail / display banner',
    'display-300x250': 'Display 300×250 — Google Ads medium rectangle',
    'display-728x90':  'Leaderboard 728×90 — Google Ads banner horizontal',
  };

  return `Você é MARIA, a Designer Estratégica e Especialista em IA Generativa da Logos IA.
Sua missão: transformar dados de negócio em prompts técnicos de design que gerem imagens de alta conversão.

════════════════════════════════════════
DADOS DO CLIENTE (Brand Kit)
════════════════════════════════════════
Marca/Cliente: ${brandKit?.clientName || 'Não definido'}
Produto/Serviço: ${brandKit?.produto || 'Não definido'}
Público-alvo: ${brandKit?.publico || 'Não definido'}
Cores da Marca: ${brandKit?.colors?.join(', ') || '#3B82F6, #8B5CF6'}
Estilo da Marca: ${brandKit?.brandStyle || 'Moderno e profissional'}

════════════════════════════════════════
PARÂMETROS DE DESIGN
════════════════════════════════════════
Objetivo: ${objLabel}
Formato: ${formatFull[format] || format}
${danielStrategy ? `Estratégia do Daniel: ${danielStrategy.slice(0, 500)}` : ''}
${pauloHeadline  ? `Headline do Paulo: "${pauloHeadline}"` : ''}
${pauloCta       ? `CTA do Paulo: "${pauloCta}"` : ''}

════════════════════════════════════════
INSTRUÇÃO
════════════════════════════════════════
Gere EXATAMENTE 3 variações de prompts técnicos de design (estilo Midjourney/Stable Diffusion/DALL-E).

Cada variação deve ser DIFERENTE na abordagem:
  1) "Impacto Visual"        — dramático, audacioso, atenção imediata (AIDA: Atenção)
  2) "Elegância Estratégica" — refinado, premium, transmite confiança e autoridade
  3) "Conexão Emocional"     — humanizado, autêntico, desperta desejo e identificação

REGRAS DO PROMPT TÉCNICO:
- Escrever em INGLÊS (melhor resultado nos geradores de imagem)
- 60-100 palavras por prompt
- SEMPRE incluir: [composição] + [iluminação] + [estilo] + [cores da marca] + [espaço para texto] + [qualidade técnica]
- NUNCA incluir texto literal (headline/CTA) no prompt — apenas referência visual ao espaço
- Otimizar para conversão em Meta Ads / Google Ads / TikTok
- Aplicar psicologia das cores alinhada ao objetivo

RESPONDA SOMENTE com JSON válido, sem texto antes ou depois:
{
  "variations": [
    {
      "nome": "nome da abordagem em pt-BR",
      "prompt": "prompt técnico em inglês, 60-100 palavras",
      "style": "photorealistic|illustration|flat|3d|minimal|neon|vintage|lifestyle",
      "format": "${format}",
      "colors": ["#HEX1", "#HEX2"],
      "rationale": "por que essa abordagem funciona para o objetivo em pt-BR (1-2 frases)"
    }
  ]
}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface MariaBriefingTabProps {
  currentFormat: string;
  onApplyPrompt: (config: ApplyConfig) => void;
}

export function MariaBriefingTab({ currentFormat, onApplyPrompt }: MariaBriefingTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  // Brand Kit
  const [brandKit, setBrandKit] = useState<BrandKit | null>(null);
  const [loadingBrandKit, setLoadingBrandKit] = useState(false);

  // Design config
  const [objective, setObjective] = useState<DesignObjective>('conversao');
  const [selectedFormat, setSelectedFormat] = useState(currentFormat);
  const [danielStrategy, setDanielStrategy] = useState('');
  const [pauloHeadline, setPauloHeadline] = useState('');
  const [pauloCta, setPauloCtaText] = useState('');

  // Variations
  const [variations, setVariations] = useState<PromptVariation[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [appliedIndex, setAppliedIndex] = useState<number | null>(null);

  // Creative Analysis
  const [analysisImage, setAnalysisImage] = useState<string | null>(null);
  const [analysisFileName, setAnalysisFileName] = useState<string | null>(null);
  const [analysisDescription, setAnalysisDescription] = useState('');
  const [analysisResult, setAnalysisResult] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const analysisInputRef = useRef<HTMLInputElement>(null);

  // Sync format when parent changes
  useEffect(() => {
    setSelectedFormat(currentFormat);
  }, [currentFormat]);

  // ─── Load brand kit from Salomão ────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    setLoadingBrandKit(true);
    (async () => {
      try {
        const { data } = await supabase
          .from('client_briefings' as any)
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (data) {
          const d = data as any;
          // Try to extract hex colors from various field names
          const rawColors = d.brand_colors || d.cores_marca || d.cores || '';
          let colors: string[] = ['#3B82F6', '#8B5CF6'];
          if (typeof rawColors === 'string') {
            const matches = rawColors.match(/#[0-9A-Fa-f]{6}/g);
            if (matches && matches.length > 0) colors = matches;
          } else if (Array.isArray(rawColors) && rawColors.length > 0) {
            colors = rawColors;
          }

          setBrandKit({
            clientName: d.client_name || d.business_name || d.nome_cliente || 'Cliente',
            produto: d.product_service || d.produto || d.servico || '',
            publico: d.target_audience || d.publico_alvo || d.publico || '',
            colors,
            brandStyle: d.brand_style || d.estilo_marca || d.posicionamento || 'Moderno e profissional',
          });
        }
      } catch {
        // No briefing yet — silent fail
      } finally {
        setLoadingBrandKit(false);
      }
    })();
  }, [user]);

  // ─── Generate 3 prompt variations ─────────────────────────────────────────
  const handleGenerateVariations = async () => {
    setIsGenerating(true);
    setVariations([]);
    setAppliedIndex(null);

    try {
      const systemInstructions = buildSystemInstructions(
        brandKit, objective, danielStrategy, pauloHeadline, pauloCta, selectedFormat,
      );

      const { data, error } = await supabase.functions.invoke('claude-chat', {
        body: {
          messages: [{ role: 'user', content: 'Gere as 3 variações de prompt de design conforme as instruções do sistema.' }],
          context: 'assistant',
          config: { description: systemInstructions, stream: false },
        },
      });

      if (error) throw new Error(error.message);

      const rawText: string =
        data?.choices?.[0]?.message?.content ||
        data?.content?.[0]?.text ||
        '';

      // Extract JSON (handle markdown code fences)
      const jsonMatch = rawText.match(/\{[\s\S]*"variations"[\s\S]*\}/);
      if (!jsonMatch) throw new Error('A IA não retornou JSON válido. Tente novamente.');

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed.variations) || parsed.variations.length === 0) {
        throw new Error('Nenhuma variação foi gerada. Tente novamente.');
      }

      setVariations(parsed.variations.slice(0, 3));
      toast({
        title: '🎨 3 variações de design prontas!',
        description: 'Escolha a abordagem ideal e clique em Aplicar.',
      });
    } catch (err: any) {
      toast({ title: 'Erro ao gerar variações', description: err.message, variant: 'destructive' });
    } finally {
      setIsGenerating(false);
    }
  };

  // ─── Apply variation → fills generate tab ─────────────────────────────────
  const handleApply = (variation: PromptVariation, index: number) => {
    setAppliedIndex(index);
    onApplyPrompt({
      prompt: variation.prompt,
      style: variation.style,
      format: variation.format || selectedFormat,
      colors: variation.colors?.length > 0 ? variation.colors : (brandKit?.colors || ['#3B82F6', '#8B5CF6']),
      headline: pauloHeadline || undefined,
      ctaText: pauloCta || undefined,
    });
    toast({ title: `✅ "${variation.nome}" aplicado!`, description: 'Vá para a aba Gerar e clique em Gerar Criativo.' });
  };

  // ─── Creative Analysis ────────────────────────────────────────────────────
  const handleAnalysisImageSelect = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: 'Arquivo muito grande', description: 'Máximo de 10MB.', variant: 'destructive' });
      return;
    }
    setAnalysisFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => setAnalysisImage(e.target?.result as string);
    reader.readAsDataURL(file);
    setAnalysisResult('');
  };

  const handleAnalyzeCreative = async () => {
    if (!analysisImage && !analysisDescription.trim()) {
      toast({ title: 'Necessário imagem ou descrição', variant: 'destructive' });
      return;
    }
    setIsAnalyzing(true);
    setAnalysisResult('');

    try {
      const brandContext = brandKit
        ? `CONTEXTO DA MARCA:\n- Cliente: ${brandKit.clientName}\n- Produto: ${brandKit.produto}\n- Público: ${brandKit.publico}\n- Cores: ${brandKit.colors.join(', ')}\n- Estilo: ${brandKit.brandStyle}\n`
        : '';

      const descContext = analysisDescription.trim()
        ? `CONTEXTO DO USUÁRIO: "${analysisDescription}"\n`
        : '';

      const analysisPrompt = `${brandContext}${descContext}
Você é MARIA, Designer Estratégica especialista em criativos de alta conversão para Meta Ads, Google Ads e TikTok.
Analise o criativo visual com rigor profissional, cobrindo:

**1. HIERARQUIA VISUAL** — O elemento principal está em destaque? O olho segue: Headline → Produto → CTA?

**2. CONTRASTE & LEGIBILIDADE** — Texto está legível em dispositivos mobile? Razão de contraste WCAG mínima respeitada?

**3. PSICOLOGIA DAS CORES** — As cores transmitem a emoção correta para o público-alvo? Estão coesas com a identidade da marca?

**4. COMPOSIÇÃO** — Regra dos terços aplicada? Espaço negativo estratégico? Ponto focal único e claro?

**5. ESPAÇO PARA TEXTO** — Há área limpa suficiente para sobreposição de headline e CTA? O produto não compete com o texto?

**6. OTIMIZAÇÃO PARA ADS** — Adequado para Meta Ads (texto < 20% da imagem), Google Display, TikTok? Thumb-stopping power?

**7. SCORE DE CONVERSÃO** — De 0 a 10, avalie a probabilidade de o criativo parar o scroll e gerar clique.

**8. TOP 3 MELHORIAS** — Liste as 3 mudanças de maior impacto (priorizadas por ROI de design).

Seja objetiva, técnica e acionável. Use **negrito** para os itens críticos.`;

      let messages: any[];
      if (analysisImage) {
        const base64 = analysisImage.split(',')[1];
        const mimeType = (analysisImage.split(';')[0].split(':')[1] || 'image/jpeg') as string;
        messages = [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
            { type: 'text', text: analysisPrompt },
          ],
        }];
      } else {
        messages = [{ role: 'user', content: analysisPrompt }];
      }

      const { data, error } = await supabase.functions.invoke('claude-chat', {
        body: { messages, context: 'assistant', config: { stream: false } },
      });

      if (error) throw new Error(error.message);

      const result =
        data?.choices?.[0]?.message?.content ||
        data?.content?.[0]?.text ||
        'Análise não disponível.';
      setAnalysisResult(result);
    } catch (err: any) {
      toast({ title: 'Erro na análise', description: err.message, variant: 'destructive' });
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="grid gap-6 lg:grid-cols-5">

      {/* ── LEFT: Controls ── */}
      <div className="lg:col-span-2 space-y-4">

        {/* Brand Kit */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Palette className="h-4 w-4 text-pink-400" />
              Brand Kit do Cliente
              {loadingBrandKit && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-auto" />}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingBrandKit ? (
              <p className="text-xs text-muted-foreground">Carregando briefing do Salomão...</p>
            ) : brandKit ? (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span className="text-sm font-semibold text-emerald-400">{brandKit.clientName}</span>
                  <Badge className="text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30 ml-auto">Injetado</Badge>
                </div>
                <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground">
                  <p>📦 <span className="text-foreground/80">{brandKit.produto}</span></p>
                  <p>👥 <span className="text-foreground/80">{brandKit.publico}</span></p>
                  <p>✨ <span className="text-foreground/80">{brandKit.brandStyle}</span></p>
                </div>
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <span className="text-[10px] text-muted-foreground shrink-0">Paleta:</span>
                  {brandKit.colors.map((c, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <div className="w-4 h-4 rounded-full border border-border/60 shadow-sm" style={{ backgroundColor: c }} />
                      <span className="text-[10px] font-mono text-muted-foreground">{c}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
                <p>
                  Nenhum briefing cadastrado. Acesse o{' '}
                  <a href="/salomao" className="text-amber-400 underline hover:text-amber-300">Salomão</a>
                  {' '}e cadastre o briefing do cliente para injetar as cores e estilo automaticamente.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Design Objective */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-orange-400" />
              Objetivo do Design
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {DESIGN_OBJECTIVES.map(obj => {
              const active = objective === obj.value;
              return (
                <button
                  key={obj.value}
                  onClick={() => setObjective(obj.value)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all duration-150 ${active ? obj.activeCls : obj.idleCls + ' opacity-70 hover:opacity-100'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">{obj.emoji}</span>
                    <span className={`text-sm font-semibold ${active ? obj.colorClass : 'text-foreground'}`}>
                      {obj.label}
                    </span>
                    {active && <CheckCircle2 className={`h-3.5 w-3.5 ml-auto ${obj.colorClass}`} />}
                  </div>
                  <p className="text-[11px] text-muted-foreground pl-7 mt-0.5">{obj.desc}</p>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Agent Context (Daniel + Paulo) */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="h-4 w-4 text-blue-400" />
              Contexto dos Agentes
              <Badge variant="outline" className="text-[9px] ml-auto">Opcional</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Daniel */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <span className="w-4 h-4 rounded bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-[9px] font-bold text-blue-400">D</span>
                Estratégia do Daniel
              </Label>
              <Textarea
                value={danielStrategy}
                onChange={(e) => setDanielStrategy(e.target.value)}
                placeholder="Cole aqui a estratégia do Daniel — persona, ângulos de abordagem, posicionamento..."
                rows={3}
                className="text-xs resize-none"
              />
            </div>

            {/* Paulo Headline */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <span className="w-4 h-4 rounded bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-[9px] font-bold text-violet-400">P</span>
                Headline do Paulo
              </Label>
              <Input
                value={pauloHeadline}
                onChange={(e) => setPauloHeadline(e.target.value)}
                placeholder="Ex: Elimine sua dor em 7 dias ou devolvemos o dinheiro"
                className="text-xs h-8"
              />
            </div>

            {/* Paulo CTA */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <span className="w-4 h-4 rounded bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-[9px] font-bold text-violet-400">P</span>
                CTA do Paulo
              </Label>
              <Input
                value={pauloCta}
                onChange={(e) => setPauloCtaText(e.target.value)}
                placeholder="Ex: Quero Experimentar Grátis"
                className="text-xs h-8"
              />
            </div>
          </CardContent>
        </Card>

        {/* Generate Button */}
        <Button
          onClick={handleGenerateVariations}
          disabled={isGenerating}
          className="w-full h-12 bg-gradient-to-r from-pink-600 to-violet-600 hover:from-pink-700 hover:to-violet-700 text-white font-bold gap-2 shadow-lg shadow-pink-500/20"
          size="lg"
        >
          {isGenerating ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Maria está criando prompts de design...</>
          ) : (
            <><Wand2 className="h-4 w-4" /> Gerar 3 Variações de Design</>
          )}
        </Button>
      </div>

      {/* ── RIGHT: Variations + Analysis ── */}
      <div className="lg:col-span-3 space-y-4">

        {/* Empty state */}
        {variations.length === 0 && !isGenerating && (
          <Card className="border-border/50 bg-card/50">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-pink-500/20 to-violet-600/20 border border-pink-500/30 flex items-center justify-center">
                <Sparkles className="h-7 w-7 text-pink-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Prompt Builder da Maria</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Configure o Brand Kit, selecione o objetivo e cole o contexto dos agentes.
                  Maria vai gerar 3 prompts técnicos de design otimizados para conversão.
                </p>
              </div>
              <div className="flex gap-2 mt-1">
                {['🎯 Conversão', '✨ Branding', '📊 Conteúdo'].map(l => (
                  <span key={l} className="text-[10px] px-2 py-0.5 rounded-full bg-muted/50 border border-border/50 text-muted-foreground">{l}</span>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Generating skeleton */}
        {isGenerating && (
          <Card className="border-border/50 bg-card/50">
            <CardContent className="py-16 flex flex-col items-center gap-4 text-muted-foreground">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-pink-500/20 to-violet-600/20 border border-pink-500/30 flex items-center justify-center">
                <Loader2 className="h-7 w-7 text-pink-400 animate-spin" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">Maria está trabalhando...</p>
                <p className="text-xs mt-1">Analisando Brand Kit + Estratégia + Objetivo → gerando 3 prompts técnicos</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Variation cards */}
        {variations.map((v, i) => {
          const meta = VARIATION_LABELS[i] || VARIATION_LABELS[0];
          const applied = appliedIndex === i;

          return (
            <Card
              key={i}
              className={`border transition-all duration-200 ${applied ? 'border-emerald-500/50 bg-emerald-500/5' : `${meta.card} hover:border-opacity-60`}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">{meta.emoji}</span>
                      <CardTitle className="text-sm">{meta.name}</CardTitle>
                    </div>
                    <p className={`text-xs font-medium mt-0.5 ${meta.accent}`}>{v.nome}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    <Badge className={`text-[9px] border ${meta.badge}`}>{v.style}</Badge>
                    <Badge variant="outline" className="text-[9px]">{FORMAT_LABELS[v.format] || v.format}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Technical prompt */}
                <div className="bg-muted/40 border border-border/40 rounded-lg p-3">
                  <p className="text-[11px] font-mono text-muted-foreground leading-relaxed">{v.prompt}</p>
                </div>

                {/* Rationale */}
                {v.rationale && (
                  <p className="text-xs text-muted-foreground italic border-l-2 border-pink-500/30 pl-2">
                    {v.rationale}
                  </p>
                )}

                {/* Color palette */}
                {v.colors && v.colors.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-muted-foreground">Paleta gerada:</span>
                    {v.colors.map((c, ci) => (
                      <div key={ci} className="flex items-center gap-1">
                        <div
                          className="w-5 h-5 rounded-full border border-border/60 shadow-sm cursor-pointer"
                          style={{ backgroundColor: c }}
                          title={c}
                        />
                        <span className="text-[10px] font-mono text-muted-foreground">{c}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Apply button */}
                <Button
                  onClick={() => handleApply(v, i)}
                  size="sm"
                  className={`w-full gap-2 font-semibold ${
                    applied
                      ? 'bg-emerald-500/10 border border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/20'
                      : 'bg-gradient-to-r from-pink-600/80 to-violet-600/80 hover:from-pink-600 hover:to-violet-600 text-white'
                  }`}
                >
                  {applied ? (
                    <><CheckCircle2 className="h-3.5 w-3.5" /> Aplicado! Vá para aba Gerar →</>
                  ) : (
                    <><Zap className="h-3.5 w-3.5" /> Aplicar este Prompt → Aba Gerar</>
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}

        {/* ── Creative Analysis ── */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4 text-sky-400" />
              Análise de Criativo com IA
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Envie um criativo existente. Maria analisa hierarquia visual, contraste, composição e score de conversão.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Image upload */}
            {analysisImage ? (
              <div className="relative rounded-xl border border-border/50 overflow-hidden">
                <img src={analysisImage} alt="Criativo" className="w-full max-h-52 object-contain bg-muted/30" />
                <button
                  onClick={() => { setAnalysisImage(null); setAnalysisFileName(null); setAnalysisResult(''); }}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 flex items-center justify-center text-white hover:bg-black/90 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <div className="bg-muted/50 px-3 py-1 text-[11px] text-muted-foreground truncate">
                  📎 {analysisFileName}
                </div>
              </div>
            ) : (
              <button
                onClick={() => analysisInputRef.current?.click()}
                className="w-full flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-muted-foreground/25 px-4 py-6 transition-all hover:border-sky-500/50 hover:bg-sky-500/5"
              >
                <Camera className="h-7 w-7 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Clique para enviar criativo • PNG, JPG, WebP até 10MB</span>
                <span className="text-[10px] text-muted-foreground/60">Ou use apenas a descrição abaixo</span>
              </button>
            )}
            <input
              ref={analysisInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAnalysisImageSelect(f); e.target.value = ''; }}
            />

            {/* Description */}
            <div className="space-y-1">
              <Label className="text-xs">Descrição ou contexto</Label>
              <Input
                value={analysisDescription}
                onChange={(e) => setAnalysisDescription(e.target.value)}
                placeholder="Ex: Anúncio de perfume feminino para Meta Ads, público 25-40 anos classe B"
                className="text-xs h-9"
              />
            </div>

            {/* Analyze button */}
            <Button
              onClick={handleAnalyzeCreative}
              disabled={isAnalyzing || (!analysisImage && !analysisDescription.trim())}
              variant="outline"
              className="w-full gap-2 border-sky-500/40 text-sky-400 hover:bg-sky-500/10 hover:border-sky-500/70"
            >
              {isAnalyzing ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Maria está analisando o criativo...</>
              ) : (
                <><TrendingUp className="h-4 w-4" /> Analisar com IA</>
              )}
            </Button>

            {/* Analysis result */}
            {analysisResult && (
              <div className="bg-sky-500/5 border border-sky-500/20 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center">
                    <Wand2 className="h-3.5 w-3.5 text-sky-400" />
                  </div>
                  <span className="text-sm font-semibold text-sky-400">Análise da Maria</span>
                </div>
                <div className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {analysisResult}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
