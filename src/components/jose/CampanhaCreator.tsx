import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import {
  Target, Globe, Megaphone, FileText, Eye, Play, ChevronRight, ChevronLeft,
  CheckCircle, Loader2, Zap, Users, TrendingUp, Sparkles, ExternalLink, X, Upload, AlertTriangle,
} from 'lucide-react';

interface ConnectedAccount {
  account_id?: string;
  id?: string;
  account_name?: string;
  currency?: string;
}

interface CampanhaCreatorProps {
  connectedAccount?: ConnectedAccount | null;
}

const OBJECTIVES = [
  { value: 'CONVERSIONS', label: 'Conversões', icon: Target, description: 'Otimizar para vendas e leads qualificados' },
  { value: 'TRAFFIC', label: 'Tráfego', icon: Globe, description: 'Direcionar pessoas para seu site ou app' },
  { value: 'REACH', label: 'Alcance', icon: Megaphone, description: 'Mostrar anúncio para o máximo de pessoas' },
  { value: 'LEAD_GENERATION', label: 'Leads', icon: FileText, description: 'Coletar dados de contato na própria Meta' },
  { value: 'BRAND_AWARENESS', label: 'Awareness', icon: Eye, description: 'Aumentar reconhecimento da marca' },
  { value: 'VIDEO_VIEWS', label: 'Vídeo Views', icon: Play, description: 'Maximizar visualizações de vídeo' },
];

const BR_STATES = [
  { value: '27', label: 'SP — São Paulo' },
  { value: '28', label: 'RJ — Rio de Janeiro' },
  { value: '29', label: 'MG — Minas Gerais' },
  { value: '30', label: 'RS — Rio Grande do Sul' },
  { value: '31', label: 'PR — Paraná' },
  { value: '32', label: 'SC — Santa Catarina' },
  { value: '33', label: 'BA — Bahia' },
  { value: '34', label: 'GO — Goiás' },
];

const CTA_OPTIONS = [
  { value: 'LEARN_MORE', label: 'Saiba Mais' },
  { value: 'SHOP_NOW', label: 'Comprar Agora' },
  { value: 'SUBSCRIBE', label: 'Inscreva-se' },
  { value: 'SIGN_UP', label: 'Cadastre-se' },
  { value: 'DOWNLOAD', label: 'Baixar' },
];

const STEP_LABELS = ['Objetivo', 'Público', 'Criativo', 'Revisão'];

export default function CampanhaCreator({ connectedAccount }: CampanhaCreatorProps) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [createdResult, setCreatedResult] = useState<{ campaign_id: string; adset_id: string; meta_ads_url: string; ad_id?: string | null; ad_warning?: string | null } | null>(null);

  // Step 1
  const [objective, setObjective] = useState('CONVERSIONS');
  const [campaignName, setCampaignName] = useState('');

  // Step 2
  const [adSetName, setAdSetName] = useState('');
  const [dailyBudget, setDailyBudget] = useState('50');
  const [allBrazil, setAllBrazil] = useState(true);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [ageRange, setAgeRange] = useState([18, 65]);
  const [gender, setGender] = useState('ALL');
  const [interests, setInterests] = useState<string[]>([]);
  const [interestInput, setInterestInput] = useState('');
  const [reachEstimate, setReachEstimate] = useState<{ lower: number; upper: number } | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 3
  const [adName, setAdName] = useState('');
  const [adFormat, setAdFormat] = useState('IMAGE');
  const [headline, setHeadline] = useState('');
  const [primaryText, setPrimaryText] = useState('');
  const [ctaButton, setCtaButton] = useState('LEARN_MORE');
  const [destinationUrl, setDestinationUrl] = useState('');
  const [adImage, setAdImage] = useState<string | null>(null); // data URL (preview + envio base64)
  const [launchStatus, setLaunchStatus] = useState<'PAUSED' | 'ACTIVE'>('PAUSED');

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast({ title: 'Imagem muito grande', description: 'Máximo 8MB.', variant: 'destructive' }); return; }
    const reader = new FileReader();
    reader.onload = () => setAdImage(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const estimateReach = useCallback(async () => {
    if (!connectedAccount?.account_id) return;
    setIsEstimating(true);
    try {
      const targetingSpec: any = {
        geo_locations: allBrazil
          ? { countries: ['BR'] }
          : { regions: selectedStates.map(s => ({ key: s })) },
        age_min: ageRange[0],
        age_max: ageRange[1],
      };
      if (gender !== 'ALL') targetingSpec.genders = [gender === 'MALE' ? 1 : 2];
      if (interests.length > 0) targetingSpec.interests = interests.map(i => ({ name: i }));

      const { data } = await (supabase as any).functions.invoke('apollo-agent', {
        body: { action: 'get_audience_insights', targetAccountId: connectedAccount.account_id, targeting_spec: targetingSpec },
      });

      if (data?.users_lower_bound) {
        setReachEstimate({ lower: data.users_lower_bound, upper: data.users_upper_bound });
      }
    } catch { /* ignore */ } finally {
      setIsEstimating(false);
    }
  }, [connectedAccount, allBrazil, selectedStates, ageRange, gender, interests]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(estimateReach, 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [estimateReach]);

  const toggleState = (val: string) => {
    setSelectedStates(prev => prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]);
  };

  const addInterest = () => {
    const trimmed = interestInput.trim();
    if (trimmed && !interests.includes(trimmed)) {
      setInterests(prev => [...prev, trimmed]);
      setInterestInput('');
    }
  };

  const handleCreate = async () => {
    if (!connectedAccount?.account_id) {
      toast({ title: 'Sem conta conectada', description: 'Conecte sua conta Meta Ads primeiro.', variant: 'destructive' });
      return;
    }

    setIsCreating(true);
    try {
      const targeting: any = {
        age_min: ageRange[0],
        age_max: ageRange[1],
        interests,
      };

      if (!allBrazil && selectedStates.length > 0) targeting.states = selectedStates;
      if (gender !== 'ALL') targeting.genders = [gender === 'MALE' ? 1 : 2];

      const { data, error } = await (supabase as any).functions.invoke('apollo-agent', {
        body: {
          action: 'create_campaign',
          targetAccountId: connectedAccount.account_id,
          name: campaignName || `${OBJECTIVES.find(o => o.value === objective)?.label} — ${new Date().toLocaleDateString('pt-BR')}`,
          objective,
          daily_budget: parseFloat(dailyBudget) || 50,
          targeting,
          ad_set_name: adSetName || undefined,
          status: launchStatus,
          creative: {
            name: adName || undefined,
            format: adFormat,
            headline: headline || undefined,
            primary_text: primaryText || undefined,
            cta: ctaButton,
            link: destinationUrl || undefined,
            image_base64: adImage || undefined,
          },
        },
      });

      if (error || data?.error) {
        toast({ title: 'Erro ao criar campanha', description: data?.error || error?.message, variant: 'destructive' });
        return;
      }

      setCreatedResult(data);
      toast({ title: '🚀 Campanha criada!', description: `ID: ${data.campaign_id} — Conjunto: ${data.adset_id}` });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsCreating(false);
    }
  };

  const formatNumber = (n: number) => n.toLocaleString('pt-BR');

  if (createdResult) {
    return (
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <CardContent className="flex flex-col items-center py-14 gap-6">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
            <CheckCircle className="h-8 w-8 text-emerald-400" />
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-xl font-bold text-emerald-400">{createdResult.ad_id ? 'Anúncio criado com sucesso!' : 'Campanha criada com sucesso!'}</h3>
            <p className="text-sm text-muted-foreground">
              {createdResult.ad_id
                ? 'Campanha, conjunto e anúncio completos no Meta Ads Manager.'
                : 'Estrutura criada no Meta Ads Manager.'}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 w-full max-w-lg">
            <div className="rounded-lg border border-border/50 p-3 text-center">
              <p className="text-[10px] text-muted-foreground">Campanha</p>
              <p className="text-xs font-mono font-semibold mt-0.5 truncate">{createdResult.campaign_id}</p>
            </div>
            <div className="rounded-lg border border-border/50 p-3 text-center">
              <p className="text-[10px] text-muted-foreground">Conjunto</p>
              <p className="text-xs font-mono font-semibold mt-0.5 truncate">{createdResult.adset_id}</p>
            </div>
            <div className="rounded-lg border border-border/50 p-3 text-center">
              <p className="text-[10px] text-muted-foreground">Anúncio</p>
              <p className="text-xs font-mono font-semibold mt-0.5 truncate">{createdResult.ad_id || '—'}</p>
            </div>
          </div>
          {createdResult.ad_warning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 max-w-lg text-left">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">{createdResult.ad_warning}</p>
            </div>
          )}
          <div className="flex gap-3">
            <Button asChild size="sm" className="gap-2 bg-orange-500 hover:bg-orange-600 text-white">
              <a href={createdResult.meta_ads_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                Abrir no Meta Ads
              </a>
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setCreatedResult(null); setStep(0); }}>
              Criar outra campanha
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stepper */}
      <div className="flex items-center gap-2">
        {STEP_LABELS.map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer
                ${i === step ? 'bg-orange-500/20 text-orange-400 border border-orange-500/40' :
                  i < step ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' :
                  'bg-muted/50 text-muted-foreground border border-border/50'}`}
              onClick={() => i < step && setStep(i)}
            >
              {i < step ? <CheckCircle className="h-3 w-3" /> : <span className="w-3 h-3 rounded-full bg-current opacity-60 flex-shrink-0" />}
              {label}
            </div>
            {i < STEP_LABELS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
          </div>
        ))}
      </div>

      {/* Step 1 — Objetivo */}
      {step === 0 && (
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-base mb-1">Qual é o objetivo da campanha?</h3>
            <p className="text-xs text-muted-foreground">O JOSÉ vai configurar a otimização automaticamente com base no objetivo escolhido.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {OBJECTIVES.map(({ value, label, icon: Icon, description }) => (
              <button
                key={value}
                onClick={() => setObjective(value)}
                className={`text-left p-4 rounded-xl border transition-all space-y-2
                  ${objective === value
                    ? 'bg-orange-500/10 border-orange-500/40 ring-1 ring-orange-500/30'
                    : 'bg-card border-border/50 hover:border-orange-500/30'}`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center
                  ${objective === value ? 'bg-orange-500/20' : 'bg-muted/50'}`}>
                  <Icon className={`h-4 w-4 ${objective === value ? 'text-orange-400' : 'text-muted-foreground'}`} />
                </div>
                <div>
                  <p className={`font-semibold text-sm ${objective === value ? 'text-orange-400' : ''}`}>{label}</p>
                  <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{description}</p>
                </div>
              </button>
            ))}
          </div>

          <div className="space-y-2 max-w-md">
            <Label className="text-xs">Nome da campanha (opcional)</Label>
            <Input
              value={campaignName}
              onChange={e => setCampaignName(e.target.value)}
              placeholder={`Ex: Black Friday — ${OBJECTIVES.find(o => o.value === objective)?.label}`}
              className="text-sm"
            />
          </div>

          <div className="flex justify-end">
            <Button onClick={() => setStep(1)} className="gap-2 bg-orange-500 hover:bg-orange-600 text-white">
              Próximo: Público <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2 — Público */}
      {step === 1 && (
        <div className="space-y-5">
          <div>
            <h3 className="font-semibold text-base mb-1">Defina o público-alvo</h3>
            <p className="text-xs text-muted-foreground">Configure quem verá seu anúncio. O JOSÉ estima o alcance em tempo real.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Nome do conjunto de anúncios</Label>
                <Input value={adSetName} onChange={e => setAdSetName(e.target.value)} placeholder="Ex: SP + RJ — 25-45 anos" className="text-sm" />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Orçamento diário (R$)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
                  <Input
                    type="number"
                    value={dailyBudget}
                    onChange={e => setDailyBudget(e.target.value)}
                    min="5"
                    className="text-sm pl-8"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Localização</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">Todo Brasil</span>
                    <Switch checked={allBrazil} onCheckedChange={setAllBrazil} className="scale-75" />
                  </div>
                </div>
                {!allBrazil && (
                  <div className="grid grid-cols-2 gap-1.5">
                    {BR_STATES.map(s => (
                      <button
                        key={s.value}
                        onClick={() => toggleState(s.value)}
                        className={`text-left px-2 py-1.5 rounded-md text-[11px] border transition-colors
                          ${selectedStates.includes(s.value)
                            ? 'bg-orange-500/10 border-orange-500/30 text-orange-400'
                            : 'border-border/50 text-muted-foreground hover:border-orange-500/20'}`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <Label className="text-xs">Faixa etária: {ageRange[0]} — {ageRange[1]} anos</Label>
                <Slider
                  value={ageRange}
                  onValueChange={setAgeRange}
                  min={18}
                  max={65}
                  step={1}
                  className="mt-2"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Gênero</Label>
                <div className="flex gap-2">
                  {[{ value: 'ALL', label: 'Todos' }, { value: 'MALE', label: 'Masculino' }, { value: 'FEMALE', label: 'Feminino' }].map(g => (
                    <button
                      key={g.value}
                      onClick={() => setGender(g.value)}
                      className={`px-3 py-1.5 rounded-md text-xs border transition-colors
                        ${gender === g.value ? 'bg-orange-500/10 border-orange-500/30 text-orange-400' : 'border-border/50 text-muted-foreground hover:border-orange-500/20'}`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Interesses</Label>
                <div className="flex gap-2">
                  <Input
                    value={interestInput}
                    onChange={e => setInterestInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addInterest()}
                    placeholder="Ex: Academia, Suplementos..."
                    className="text-sm flex-1"
                  />
                  <Button size="sm" variant="outline" onClick={addInterest} className="px-3">+</Button>
                </div>
                {interests.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {interests.map(i => (
                      <Badge key={i} variant="outline" className="text-[11px] bg-orange-500/5 text-orange-400 border-orange-500/30 gap-1">
                        {i}
                        <button onClick={() => setInterests(prev => prev.filter(x => x !== i))}>
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Reach estimate */}
              <div className={`rounded-xl border p-4 transition-all ${reachEstimate ? 'border-orange-500/30 bg-orange-500/5' : 'border-border/50 bg-muted/20'}`}>
                <div className="flex items-center gap-2 mb-3">
                  <Users className={`h-4 w-4 ${reachEstimate ? 'text-orange-400' : 'text-muted-foreground'}`} />
                  <span className="text-xs font-medium">Alcance estimado</span>
                  {isEstimating && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />}
                </div>
                {reachEstimate ? (
                  <div>
                    <p className="text-2xl font-bold text-orange-400">
                      {formatNumber(reachEstimate.lower)} — {formatNumber(reachEstimate.upper)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">pessoas ativas por mês</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Ajuste os parâmetros para ver o alcance estimado</p>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(0)} className="gap-2">
              <ChevronLeft className="h-4 w-4" /> Voltar
            </Button>
            <Button onClick={() => setStep(2)} className="gap-2 bg-orange-500 hover:bg-orange-600 text-white">
              Próximo: Criativo <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3 — Criativo */}
      {step === 2 && (
        <div className="space-y-5">
          <div>
            <h3 className="font-semibold text-base mb-1">Configure o criativo</h3>
            <p className="text-xs text-muted-foreground">Defina o conteúdo do anúncio. Você pode ajustar detalhes diretamente no Meta Ads Manager depois.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Nome do anúncio</Label>
                <Input value={adName} onChange={e => setAdName(e.target.value)} placeholder="Ex: Criativo Principal — Foto Produto" className="text-sm" />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Formato</Label>
                <div className="flex gap-2">
                  {[{ value: 'IMAGE', label: 'Imagem' }, { value: 'CAROUSEL', label: 'Carrossel' }, { value: 'VIDEO', label: 'Vídeo' }].map(f => (
                    <button
                      key={f.value}
                      onClick={() => setAdFormat(f.value)}
                      className={`flex-1 py-2 rounded-md text-xs border transition-colors
                        ${adFormat === f.value ? 'bg-orange-500/10 border-orange-500/30 text-orange-400' : 'border-border/50 text-muted-foreground hover:border-orange-500/20'}`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Título (headline)</Label>
                <Input value={headline} onChange={e => setHeadline(e.target.value)} placeholder="Ex: Transforme seus resultados hoje" className="text-sm" />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Texto principal</Label>
                <Textarea
                  value={primaryText}
                  onChange={e => setPrimaryText(e.target.value)}
                  placeholder="Descreva sua oferta, benefícios e o que o cliente vai ganhar..."
                  rows={4}
                  className="text-sm resize-none"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Botão de ação (CTA)</Label>
                <Select value={ctaButton} onValueChange={setCtaButton}>
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CTA_OPTIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">URL de destino</Label>
                <Input
                  value={destinationUrl}
                  onChange={e => setDestinationUrl(e.target.value)}
                  placeholder="https://seusite.com.br/oferta"
                  type="url"
                  className="text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Imagem do anúncio</Label>
                <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 bg-muted/20 p-4 text-center hover:border-orange-500/40">
                  {adImage ? (
                    <img src={adImage} alt="prévia" className="max-h-40 w-full rounded object-contain" />
                  ) : (
                    <>
                      <Upload className="h-5 w-5 text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground">Clique para escolher a imagem (JPG/PNG, até 8MB)</span>
                    </>
                  )}
                  <input type="file" accept="image/*" className="hidden" onChange={onPickImage} />
                </label>
                {adImage && <button onClick={() => setAdImage(null)} className="text-[11px] text-muted-foreground hover:text-foreground">Remover imagem</button>}
              </div>

              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-400" />
                  <p className="text-xs font-semibold text-amber-400">Como o JOSÉ cria</p>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Com a imagem + o texto acima, o JOSÉ monta o anúncio COMPLETO (imagem, título, texto e botão) já ligado ao conjunto. Sem imagem, ele cria só a campanha e o conjunto, e você finaliza o anúncio no Meta com o texto que escreveu. Precisa de uma Página do Facebook conectada à conta.
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)} className="gap-2">
              <ChevronLeft className="h-4 w-4" /> Voltar
            </Button>
            <Button onClick={() => setStep(3)} className="gap-2 bg-orange-500 hover:bg-orange-600 text-white">
              Revisão Final <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 4 — Revisão */}
      {step === 3 && (
        <div className="space-y-5">
          <div>
            <h3 className="font-semibold text-base mb-1">Revisão e lançamento</h3>
            <p className="text-xs text-muted-foreground">Confirme os detalhes antes de criar a campanha no Meta Ads.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="border-border/50">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Campanha</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Objetivo</span>
                  <Badge variant="outline" className="text-orange-400 border-orange-500/30">
                    {OBJECTIVES.find(o => o.value === objective)?.label}
                  </Badge>
                </div>
                {campaignName && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Nome</span>
                    <span className="font-medium text-right max-w-[200px] truncate">{campaignName}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Público</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Orçamento/dia</span>
                  <span className="font-semibold text-emerald-400">R$ {parseFloat(dailyBudget || '50').toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Localização</span>
                  <span className="font-medium">{allBrazil ? 'Todo Brasil' : `${selectedStates.length} estado(s)`}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Idade</span>
                  <span className="font-medium">{ageRange[0]} — {ageRange[1]} anos</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Gênero</span>
                  <span className="font-medium">{{ ALL: 'Todos', MALE: 'Masculino', FEMALE: 'Feminino' }[gender]}</span>
                </div>
                {interests.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {interests.slice(0, 4).map(i => (
                      <Badge key={i} variant="outline" className="text-[10px]">{i}</Badge>
                    ))}
                    {interests.length > 4 && <Badge variant="outline" className="text-[10px]">+{interests.length - 4}</Badge>}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50 md:col-span-2">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Criativo</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-[11px]">Formato</p>
                    <p className="font-medium">{adFormat}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-[11px]">CTA</p>
                    <p className="font-medium">{CTA_OPTIONS.find(c => c.value === ctaButton)?.label}</p>
                  </div>
                  {destinationUrl && (
                    <div>
                      <p className="text-muted-foreground text-[11px]">Destino</p>
                      <p className="font-medium truncate text-xs">{destinationUrl}</p>
                    </div>
                  )}
                </div>
                {headline && <p className="text-sm font-semibold mt-2">"{headline}"</p>}
              </CardContent>
            </Card>
          </div>

          {/* Status toggle */}
          <div className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-card">
            <div>
              <p className="text-sm font-semibold">Status ao criar</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {launchStatus === 'PAUSED' ? 'Campanha criada pausada — ative quando o criativo estiver pronto.' : 'Campanha criada ativa — começará a gastar imediatamente.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Pausada</span>
              <Switch
                checked={launchStatus === 'ACTIVE'}
                onCheckedChange={v => setLaunchStatus(v ? 'ACTIVE' : 'PAUSED')}
              />
              <span className={`text-xs font-medium ${launchStatus === 'ACTIVE' ? 'text-emerald-400' : 'text-muted-foreground'}`}>Ativa</span>
            </div>
          </div>

          {!connectedAccount?.account_id && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-xs text-amber-400">Nenhuma conta Meta Ads conectada. Conecte sua conta em Configurações → Integrações.</p>
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)} className="gap-2">
              <ChevronLeft className="h-4 w-4" /> Voltar
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isCreating || !connectedAccount?.account_id}
              className="gap-2 bg-orange-500 hover:bg-orange-600 text-white min-w-[200px]"
            >
              {isCreating
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Criando...</>
                : <><Zap className="h-4 w-4" /> Criar Campanha com JOSÉ</>
              }
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
