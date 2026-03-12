import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSuperGestor } from '@/hooks/useSuperGestor';
import { CampaignContext } from '@/services/claude';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import {
  Package,
  Target,
  Users,
  Wallet,
  Globe,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Loader2,
  ShoppingCart,
  UserPlus,
  MousePointer,
  Eye,
  Check,
} from 'lucide-react';

const CriarCampanha = () => {
  const navigate = useNavigate();
  const { generateStrategy, isLoading } = useSuperGestor();
  
  const [step, setStep] = useState(1);
  const totalSteps = 5;
  
  const [formData, setFormData] = useState({
    product: '',
    niche: '',
    price: '',
    landingPageUrl: '',
    objective: '' as 'vendas' | 'leads' | 'trafego' | 'awareness' | '',
    targetAudience: '',
    ageMin: 25,
    ageMax: 55,
    locations: 'Brasil',
    budget: 1000,
    budgetType: 'daily' as 'daily' | 'lifetime',
    duration: 30,
    platforms: [] as string[],
  });

  const updateField = (field: string, value: unknown) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const togglePlatform = (platform: string) => {
    setFormData(prev => ({
      ...prev,
      platforms: prev.platforms.includes(platform)
        ? prev.platforms.filter(p => p !== platform)
        : [...prev.platforms, platform]
    }));
  };

  const isStepValid = () => {
    switch (step) {
      case 1: return formData.product.trim().length > 0;
      case 2: return formData.objective !== '';
      case 3: return formData.targetAudience.trim().length > 0;
      case 4: return formData.budget > 0;
      case 5: return formData.platforms.length > 0;
      default: return false;
    }
  };

  const nextStep = () => {
    if (step < totalSteps && isStepValid()) setStep(step + 1);
  };

  const prevStep = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleComplete = async () => {
    if (!isStepValid()) return;

    const context: CampaignContext = {
      product: formData.product,
      niche: formData.niche || undefined,
      price: formData.price ? Number(formData.price) : undefined,
      landingPageUrl: formData.landingPageUrl || undefined,
      objective: formData.objective as CampaignContext['objective'],
      targetAudience: formData.targetAudience,
      ageRange: { min: formData.ageMin, max: formData.ageMax },
      locations: [formData.locations],
      budget: formData.budget,
      budgetType: formData.budgetType,
      duration: formData.duration,
      platforms: formData.platforms as CampaignContext['platforms'],
    };

    const strategy = await generateStrategy(context);
    if (strategy) {
      navigate('/midas');
    }
  };

  const objectives = [
    { value: 'vendas', label: 'Vendas', icon: ShoppingCart, desc: 'Gerar compras diretas' },
    { value: 'leads', label: 'Leads', icon: UserPlus, desc: 'Capturar contatos' },
    { value: 'trafego', label: 'Tráfego', icon: MousePointer, desc: 'Visitas ao site' },
    { value: 'awareness', label: 'Reconhecimento', icon: Eye, desc: 'Alcançar pessoas' },
  ];

  const platforms = [
    { id: 'meta', name: 'Meta Ads', icon: '📘', desc: 'Facebook, Instagram, Messenger' },
    { id: 'google', name: 'Google Ads', icon: '📊', desc: 'Pesquisa, Display, YouTube' },
    { id: 'tiktok', name: 'TikTok Ads', icon: '🎵', desc: 'Vídeos curtos' },
  ];

  const budgetSuggestions = [500, 1000, 2000, 3000, 5000];

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="max-w-2xl mx-auto px-4">
        
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">Criar Nova Campanha</h1>
          <p className="text-muted-foreground">Preencha as informações e a IA criará sua estratégia</p>
        </div>

        <div className="mb-8">
          <div className="flex justify-between text-sm text-muted-foreground mb-2">
            <span>Passo {step} de {totalSteps}</span>
            <span>{Math.round((step / totalSteps) * 100)}%</span>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-primary to-primary/80 transition-all duration-300"
              style={{ width: `${(step / totalSteps) * 100}%` }}
            />
          </div>
        </div>

        <Card className="bg-card border-border p-6">
          
          {step === 1 && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Package className="w-8 h-8 text-primary" />
                </div>
                <h2 className="text-xl font-bold text-foreground">O que você vende?</h2>
                <p className="text-muted-foreground text-sm">Descreva seu produto ou serviço</p>
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-2">Nome do Produto/Serviço *</label>
                <Input value={formData.product} onChange={(e) => updateField('product', e.target.value)} placeholder="Ex: Curso de Marketing Digital" />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-2">Nicho de Mercado</label>
                <Input value={formData.niche} onChange={(e) => updateField('niche', e.target.value)} placeholder="Ex: Educação online, Infoprodutos" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">Preço (R$)</label>
                  <Input type="number" value={formData.price} onChange={(e) => updateField('price', e.target.value)} placeholder="297" />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">URL da Landing Page</label>
                  <Input value={formData.landingPageUrl} onChange={(e) => updateField('landingPageUrl', e.target.value)} placeholder="https://..." />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Target className="w-8 h-8 text-primary" />
                </div>
                <h2 className="text-xl font-bold text-foreground">Qual seu objetivo?</h2>
                <p className="text-muted-foreground text-sm">Escolha o principal objetivo da campanha</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {objectives.map((obj) => (
                  <button
                    key={obj.value}
                    onClick={() => updateField('objective', obj.value)}
                    className={`p-4 rounded-xl border text-left transition-all ${
                      formData.objective === obj.value
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-muted-foreground bg-secondary'
                    }`}
                  >
                    <obj.icon className={`w-6 h-6 mb-2 ${formData.objective === obj.value ? 'text-primary' : 'text-muted-foreground'}`} />
                    <p className="font-medium text-foreground">{obj.label}</p>
                    <p className="text-xs text-muted-foreground">{obj.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8 text-primary" />
                </div>
                <h2 className="text-xl font-bold text-foreground">Quem é seu público?</h2>
                <p className="text-muted-foreground text-sm">Descreva seu cliente ideal</p>
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-2">Descrição do Público-Alvo *</label>
                <Textarea
                  value={formData.targetAudience}
                  onChange={(e) => updateField('targetAudience', e.target.value)}
                  placeholder="Ex: Empreendedores de 25-45 anos interessados em marketing digital e vendas online"
                  rows={4}
                  className="resize-none"
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">Idade Mínima</label>
                  <Input type="number" value={formData.ageMin} onChange={(e) => updateField('ageMin', Number(e.target.value))} />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">Idade Máxima</label>
                  <Input type="number" value={formData.ageMax} onChange={(e) => updateField('ageMax', Number(e.target.value))} />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">Localização</label>
                  <Input value={formData.locations} onChange={(e) => updateField('locations', e.target.value)} placeholder="Brasil" />
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Wallet className="w-8 h-8 text-primary" />
                </div>
                <h2 className="text-xl font-bold text-foreground">Qual seu orçamento?</h2>
                <p className="text-muted-foreground text-sm">Defina quanto quer investir</p>
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-2">Orçamento (R$)</label>
                <Input
                  type="number"
                  value={formData.budget}
                  onChange={(e) => updateField('budget', Number(e.target.value))}
                  className="text-2xl font-bold text-center h-16"
                />
              </div>
              <div className="flex justify-center gap-2 flex-wrap">
                {budgetSuggestions.map((value) => (
                  <button
                    key={value}
                    onClick={() => updateField('budget', value)}
                    className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                      formData.budget === value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    R$ {value.toLocaleString()}
                  </button>
                ))}
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => updateField('budgetType', 'daily')}
                  className={`flex-1 p-4 rounded-xl border text-center transition-all ${
                    formData.budgetType === 'daily' ? 'border-primary bg-primary/10' : 'border-border bg-secondary'
                  }`}
                >
                  <p className="font-medium text-foreground">Diário</p>
                  <p className="text-xs text-muted-foreground">Gasto por dia</p>
                </button>
                <button
                  onClick={() => updateField('budgetType', 'lifetime')}
                  className={`flex-1 p-4 rounded-xl border text-center transition-all ${
                    formData.budgetType === 'lifetime' ? 'border-primary bg-primary/10' : 'border-border bg-secondary'
                  }`}
                >
                  <p className="font-medium text-foreground">Total</p>
                  <p className="text-xs text-muted-foreground">Gasto total da campanha</p>
                </button>
              </div>
              {formData.budgetType === 'lifetime' && (
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">Duração (dias)</label>
                  <Input type="number" value={formData.duration} onChange={(e) => updateField('duration', Number(e.target.value))} />
                </div>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Globe className="w-8 h-8 text-primary" />
                </div>
                <h2 className="text-xl font-bold text-foreground">Onde anunciar?</h2>
                <p className="text-muted-foreground text-sm">Selecione as plataformas (pelo menos uma)</p>
              </div>
              <div className="space-y-3">
                {platforms.map((platform) => (
                  <button
                    key={platform.id}
                    onClick={() => togglePlatform(platform.id)}
                    className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all ${
                      formData.platforms.includes(platform.id)
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-secondary hover:border-muted-foreground'
                    }`}
                  >
                    <span className="text-3xl">{platform.icon}</span>
                    <div className="text-left flex-1">
                      <p className="font-medium text-foreground">{platform.name}</p>
                      <p className="text-xs text-muted-foreground">{platform.desc}</p>
                    </div>
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                      formData.platforms.includes(platform.id) ? 'bg-primary border-primary' : 'border-muted-foreground'
                    }`}>
                      {formData.platforms.includes(platform.id) && <Check className="w-4 h-4 text-primary-foreground" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-between mt-8 pt-6 border-t border-border">
            <Button variant="ghost" onClick={step === 1 ? () => navigate('/midas') : prevStep} className="text-muted-foreground">
              <ArrowLeft className="w-4 h-4 mr-2" />
              {step === 1 ? 'Cancelar' : 'Voltar'}
            </Button>
            {step < totalSteps ? (
              <Button onClick={nextStep} disabled={!isStepValid()} className="bg-primary hover:bg-primary/90">
                Próximo
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button
                onClick={handleComplete}
                disabled={!isStepValid() || isLoading}
                className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
              >
                {isLoading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Gerando Estratégia...</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-2" /> Gerar Estratégia com IA</>
                )}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default CriarCampanha;
