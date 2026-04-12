import { useState, useEffect, KeyboardEvent } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Save, MapPin, Users, BarChart2, BookOpen,
  Plus, X, AlertTriangle, Loader2,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface KnowledgeBase {
  // Financeiro
  cpl_min: number;
  cpl_max: number;
  cpl_optimal: number;
  cpa_min: number;
  cpa_max: number;
  cpa_optimal: number;
  budget_daily_min: number;
  budget_daily_max: number;
  // Geo
  geo_type: 'radius' | 'cities' | 'states';
  geo_cities: string[];
  geo_states: string[];
  geo_radius_km: number;
  geo_center_city: string;
  geo_exclude_cities: string[];
  // Público
  age_min: number;
  age_max: number;
  gender: 'all' | 'male' | 'female';
  interests: string[];
  behaviors: string[];
  // Criativos
  creative_rotation_days: number;
  max_frequency: number;
  // Regras
  custom_rules: string[];
}

const DEFAULT_KB: KnowledgeBase = {
  cpl_min: 0,
  cpl_max: 80,
  cpl_optimal: 40,
  cpa_min: 0,
  cpa_max: 500,
  cpa_optimal: 200,
  budget_daily_min: 30,
  budget_daily_max: 500,
  geo_type: 'cities',
  geo_cities: [],
  geo_states: [],
  geo_radius_km: 50,
  geo_center_city: '',
  geo_exclude_cities: [],
  age_min: 25,
  age_max: 55,
  gender: 'all',
  interests: [],
  behaviors: [],
  creative_rotation_days: 21,
  max_frequency: 4.5,
  custom_rules: [],
};

const ESTADOS_BR = [
  { code: 'AC', name: 'Acre' },
  { code: 'AL', name: 'Alagoas' },
  { code: 'AP', name: 'Amapá' },
  { code: 'AM', name: 'Amazonas' },
  { code: 'BA', name: 'Bahia' },
  { code: 'CE', name: 'Ceará' },
  { code: 'DF', name: 'Distrito Federal' },
  { code: 'ES', name: 'Espírito Santo' },
  { code: 'GO', name: 'Goiás' },
  { code: 'MA', name: 'Maranhão' },
  { code: 'MT', name: 'Mato Grosso' },
  { code: 'MS', name: 'Mato Grosso do Sul' },
  { code: 'MG', name: 'Minas Gerais' },
  { code: 'PA', name: 'Pará' },
  { code: 'PB', name: 'Paraíba' },
  { code: 'PR', name: 'Paraná' },
  { code: 'PE', name: 'Pernambuco' },
  { code: 'PI', name: 'Piauí' },
  { code: 'RJ', name: 'Rio de Janeiro' },
  { code: 'RN', name: 'Rio Grande do Norte' },
  { code: 'RS', name: 'Rio Grande do Sul' },
  { code: 'RO', name: 'Rondônia' },
  { code: 'RR', name: 'Roraima' },
  { code: 'SC', name: 'Santa Catarina' },
  { code: 'SP', name: 'São Paulo' },
  { code: 'SE', name: 'Sergipe' },
  { code: 'TO', name: 'Tocantins' },
];

// ── Sub-components ─────────────────────────────────────────────────────────────

function TagList({
  items,
  onRemove,
  variant = 'default',
}: {
  items: string[];
  onRemove: (item: string) => void;
  variant?: 'default' | 'red';
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {items.map(item => (
        <Badge
          key={item}
          variant="outline"
          className={`text-xs gap-1 pr-1 ${
            variant === 'red'
              ? 'border-red-500/30 text-red-400 bg-red-500/10'
              : 'border-border/60'
          }`}
        >
          {item}
          <button
            onClick={() => onRemove(item)}
            className="hover:text-destructive transition-colors"
            aria-label={`Remover ${item}`}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}

function TagInput({
  placeholder,
  onAdd,
}: {
  placeholder: string;
  onAdd: (value: string) => void;
}) {
  const [value, setValue] = useState('');

  const handleAdd = () => {
    const trimmed = value.trim();
    if (trimmed) {
      onAdd(trimmed);
      setValue('');
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="flex gap-2">
      <Input
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKey}
        placeholder={placeholder}
        className="h-8 text-sm"
      />
      <Button type="button" size="sm" variant="outline" className="h-8 px-2.5" onClick={handleAdd}>
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface SegmentKnowledgeBaseProps {
  segmentSlug: string;
}

export function SegmentKnowledgeBase({ segmentSlug }: SegmentKnowledgeBaseProps) {
  const { toast } = useToast();
  const [kb, setKb] = useState<KnowledgeBase>(DEFAULT_KB);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!segmentSlug) return;
    setIsLoading(true);

    supabase
      .from('jose_segment_profiles' as any)
      .select('knowledge_base')
      .eq('slug', segmentSlug)
      .single()
      .then(({ data, error }) => {
        if (!error && data && (data as any).knowledge_base) {
          setKb({ ...DEFAULT_KB, ...(data as any).knowledge_base });
        }
        setIsLoading(false);
      });
  }, [segmentSlug]);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setIsSaving(true);
    const { error } = await supabase
      .from('jose_segment_profiles' as any)
      .update({ knowledge_base: kb })
      .eq('slug', segmentSlug);

    setIsSaving(false);
    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '✅ Base de conhecimento salva!', description: 'José usará esses dados na próxima análise.' });
    }
  };

  // ── Field helpers ──────────────────────────────────────────────────────────
  const set = <K extends keyof KnowledgeBase>(field: K, value: KnowledgeBase[K]) =>
    setKb(prev => ({ ...prev, [field]: value }));

  const addToList = (field: 'geo_cities' | 'geo_states' | 'geo_exclude_cities' | 'interests' | 'behaviors' | 'custom_rules') =>
    (value: string) => {
      setKb(prev => ({
        ...prev,
        [field]: prev[field].includes(value) ? prev[field] : [...prev[field], value],
      }));
    };

  const removeFromList = (field: 'geo_cities' | 'geo_states' | 'geo_exclude_cities' | 'interests' | 'behaviors' | 'custom_rules') =>
    (value: string) => {
      setKb(prev => ({ ...prev, [field]: prev[field].filter(v => v !== value) }));
    };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="font-semibold text-sm">Base de Conhecimento do Segmento</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Configure os benchmarks e regras que o José deve seguir para este segmento.
        </p>
      </div>

      <Tabs defaultValue="metricas">
        <TabsList className="w-full grid grid-cols-4 h-9">
          <TabsTrigger value="metricas" className="text-xs gap-1">
            <BarChart2 className="h-3.5 w-3.5" />
            Métricas
          </TabsTrigger>
          <TabsTrigger value="localizacao" className="text-xs gap-1">
            <MapPin className="h-3.5 w-3.5" />
            Localização
          </TabsTrigger>
          <TabsTrigger value="publico" className="text-xs gap-1">
            <Users className="h-3.5 w-3.5" />
            Público
          </TabsTrigger>
          <TabsTrigger value="regras" className="text-xs gap-1">
            <BookOpen className="h-3.5 w-3.5" />
            Regras
          </TabsTrigger>
        </TabsList>

        {/* ── MÉTRICAS ── */}
        <TabsContent value="metricas" className="mt-3 space-y-3">
          {/* CPL */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="font-semibold text-sm">CPL — Custo por Lead</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Mínimo aceitável (R$)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={kb.cpl_min}
                    onChange={e => set('cpl_min', Number(e.target.value))}
                    className="h-8 mt-1 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Meta / Ótimo (R$)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={kb.cpl_optimal}
                    onChange={e => set('cpl_optimal', Number(e.target.value))}
                    className="h-8 mt-1 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Máximo / Corte (R$)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={kb.cpl_max}
                    onChange={e => set('cpl_max', Number(e.target.value))}
                    className="h-8 mt-1 text-sm"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* CPA */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="font-semibold text-sm">CPA — Custo por Aquisição</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Mínimo aceitável (R$)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={kb.cpa_min}
                    onChange={e => set('cpa_min', Number(e.target.value))}
                    className="h-8 mt-1 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Meta / Ótimo (R$)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={kb.cpa_optimal}
                    onChange={e => set('cpa_optimal', Number(e.target.value))}
                    className="h-8 mt-1 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Máximo / Corte (R$)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={kb.cpa_max}
                    onChange={e => set('cpa_max', Number(e.target.value))}
                    className="h-8 mt-1 text-sm"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Orçamento + Criativos */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="font-semibold text-sm">Orçamento & Criativos</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Orçamento diário mínimo (R$)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={kb.budget_daily_min}
                    onChange={e => set('budget_daily_min', Number(e.target.value))}
                    className="h-8 mt-1 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Orçamento diário máximo (R$)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={kb.budget_daily_max}
                    onChange={e => set('budget_daily_max', Number(e.target.value))}
                    className="h-8 mt-1 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Frequência máxima</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    value={kb.max_frequency}
                    onChange={e => set('max_frequency', Number(e.target.value))}
                    className="h-8 mt-1 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Rotação de criativos (dias)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={kb.creative_rotation_days}
                    onChange={e => set('creative_rotation_days', Number(e.target.value))}
                    className="h-8 mt-1 text-sm"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── LOCALIZAÇÃO ── */}
        <TabsContent value="localizacao" className="mt-3 space-y-3">
          <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-400">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              Venda de veículos deve ser segmentada por região. Nunca anuncie para todo o Brasil — isso desperdiça orçamento e dilui a relevância dos anúncios.
            </span>
          </div>

          <Card>
            <CardContent className="p-4 space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground">Tipo de segmentação geográfica</Label>
                <Select
                  value={kb.geo_type}
                  onValueChange={v => set('geo_type', v as KnowledgeBase['geo_type'])}
                >
                  <SelectTrigger className="mt-1 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cities">Cidades específicas</SelectItem>
                    <SelectItem value="radius">Raio em torno de uma cidade</SelectItem>
                    <SelectItem value="states">Estados</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Radius */}
              {kb.geo_type === 'radius' && (
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Cidade central</Label>
                    <Input
                      value={kb.geo_center_city}
                      onChange={e => set('geo_center_city', e.target.value)}
                      placeholder="Ex: São Paulo, SP"
                      className="h-8 mt-1 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Raio: <strong>{kb.geo_radius_km} km</strong>
                    </Label>
                    <input
                      type="range"
                      min={10}
                      max={200}
                      step={5}
                      value={kb.geo_radius_km}
                      onChange={e => set('geo_radius_km', Number(e.target.value))}
                      className="w-full mt-1.5 accent-orange-500"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                      <span>10 km</span>
                      <span>200 km</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Cities */}
              {kb.geo_type === 'cities' && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Cidades</Label>
                  <TagInput placeholder="Ex: Campinas, Ribeirão Preto..." onAdd={addToList('geo_cities')} />
                  <TagList items={kb.geo_cities} onRemove={removeFromList('geo_cities')} />
                </div>
              )}

              {/* States */}
              {kb.geo_type === 'states' && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Estados</Label>
                  <Select onValueChange={addToList('geo_states')}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Selecionar estado..." />
                    </SelectTrigger>
                    <SelectContent>
                      {ESTADOS_BR
                        .filter(e => !kb.geo_states.includes(e.code))
                        .map(e => (
                          <SelectItem key={e.code} value={e.code}>
                            {e.code} — {e.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <TagList items={kb.geo_states} onRemove={removeFromList('geo_states')} />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Exclusões */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <p className="font-semibold text-sm">Excluir regiões</p>
              <p className="text-xs text-muted-foreground">Cidades ou regiões que não devem ser alcançadas pelo anúncio.</p>
              <TagInput placeholder="Ex: Guarulhos, ABC Paulista..." onAdd={addToList('geo_exclude_cities')} />
              <TagList items={kb.geo_exclude_cities} onRemove={removeFromList('geo_exclude_cities')} variant="red" />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── PÚBLICO ── */}
        <TabsContent value="publico" className="mt-3 space-y-3">
          {/* Faixa etária + gênero */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="font-semibold text-sm">Faixa etária & gênero</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Idade mínima</Label>
                  <Input
                    type="number"
                    min={13}
                    max={65}
                    value={kb.age_min}
                    onChange={e => set('age_min', Number(e.target.value))}
                    className="h-8 mt-1 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Idade máxima</Label>
                  <Input
                    type="number"
                    min={13}
                    max={65}
                    value={kb.age_max}
                    onChange={e => set('age_max', Number(e.target.value))}
                    className="h-8 mt-1 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Gênero</Label>
                  <Select
                    value={kb.gender}
                    onValueChange={v => set('gender', v as KnowledgeBase['gender'])}
                  >
                    <SelectTrigger className="mt-1 h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="male">Masculino</SelectItem>
                      <SelectItem value="female">Feminino</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Interesses */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <p className="font-semibold text-sm">Interesses</p>
              <TagInput placeholder="Ex: Carros, Honda, Toyota..." onAdd={addToList('interests')} />
              <TagList items={kb.interests} onRemove={removeFromList('interests')} />
            </CardContent>
          </Card>

          {/* Comportamentos */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <p className="font-semibold text-sm">Comportamentos</p>
              <TagInput placeholder="Ex: Alta renda, CNH, Compradores online..." onAdd={addToList('behaviors')} />
              <TagList items={kb.behaviors} onRemove={removeFromList('behaviors')} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── REGRAS ── */}
        <TabsContent value="regras" className="mt-3 space-y-3">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div>
                <p className="font-semibold text-sm">Regras personalizadas</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Instruções que o José deve seguir ao analisar e otimizar campanhas deste segmento.
                </p>
              </div>

              <TagInput
                placeholder="Ex: Nunca pausar campanha no fim de semana"
                onAdd={addToList('custom_rules')}
              />

              {kb.custom_rules.length > 0 ? (
                <ol className="space-y-2 mt-2">
                  {kb.custom_rules.map((rule, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="shrink-0 text-muted-foreground text-xs mt-0.5 w-5 text-right">{i + 1}.</span>
                      <span className="flex-1 leading-snug">{rule}</span>
                      <button
                        onClick={() => removeFromList('custom_rules')(rule)}
                        className="shrink-0 text-muted-foreground hover:text-destructive transition-colors mt-0.5"
                        aria-label="Remover regra"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Nenhuma regra adicionada ainda.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Button
        className="w-full h-10 gap-2"
        onClick={handleSave}
        disabled={isSaving}
      >
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Salvar base de conhecimento
      </Button>
    </div>
  );
}
