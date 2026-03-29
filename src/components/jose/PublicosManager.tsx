import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  Users, Plus, RefreshCw, Search, Loader2, Target, Zap, BarChart3, BookMarked,
} from 'lucide-react';

interface ConnectedAccount {
  account_id?: string;
  id?: string;
  account_name?: string;
}

interface Audience {
  id: string;
  name: string;
  subtype: string;
  approximate_count: number;
  delivery_status?: { code: number; description: string };
  data_source?: { type: string };
}

interface PublicosManagerProps {
  connectedAccount?: ConnectedAccount | null;
}

const SAVED_SEGMENTS = [
  { name: 'Topo de Funil BR', description: 'Todo Brasil · 18-45 · interesses amplos', size: '45M – 80M', color: 'text-blue-400', border: 'border-blue-500/30', bg: 'bg-blue-500/5' },
  { name: 'Remarketing 30 dias', description: 'Visitantes do site nos últimos 30 dias', size: 'Personalizado', color: 'text-purple-400', border: 'border-purple-500/30', bg: 'bg-purple-500/5' },
  { name: 'Lookalike 1% Clientes', description: 'Semelhante à sua base de clientes', size: '~1.5M', color: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/5' },
  { name: 'Engajados 60 dias', description: 'Interagiram com perfil ou página nos últimos 60 dias', size: 'Personalizado', color: 'text-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/5' },
];

const subtypeBadge = (subtype: string) => {
  const map: Record<string, string> = {
    CUSTOM: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    LOOKALIKE: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    SAVED_AUDIENCE: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    WEBSITE: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    ENGAGEMENT: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  };
  return map[subtype] || 'bg-muted text-muted-foreground';
};

const subtypeLabel = (subtype: string) => {
  const labels: Record<string, string> = {
    CUSTOM: 'Personalizado',
    LOOKALIKE: 'Lookalike',
    SAVED_AUDIENCE: 'Salvo',
    WEBSITE: 'Website',
    ENGAGEMENT: 'Engajamento',
  };
  return labels[subtype] || subtype;
};

const deliveryStatusColor = (code?: number) => {
  if (!code) return 'text-muted-foreground';
  if (code === 200) return 'text-emerald-400';
  if (code === 400) return 'text-amber-400';
  return 'text-red-400';
};

export default function PublicosManager({ connectedAccount }: PublicosManagerProps) {
  const { toast } = useToast();
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [isLoadingAudiences, setIsLoadingAudiences] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Reach estimator state
  const [estimateCountry, setEstimateCountry] = useState('BR');
  const [estimateAge, setEstimateAge] = useState([18, 65]);
  const [estimateGender, setEstimateGender] = useState('ALL');
  const [isEstimating, setIsEstimating] = useState(false);
  const [estimateResult, setEstimateResult] = useState<{ lower: number; upper: number } | null>(null);

  // Lookalike form
  const [lookalikeSrc, setLookalikeSrc] = useState('');
  const [lookalikePct, setLookalikePct] = useState('1');
  const [isCreatingLookalike, setIsCreatingLookalike] = useState(false);

  // Create custom audience
  const [newAudienceName, setNewAudienceName] = useState('');
  const [isCreatingAudience, setIsCreatingAudience] = useState(false);

  const loadAudiences = async () => {
    if (!connectedAccount?.account_id) return;
    setIsLoadingAudiences(true);
    try {
      const { data } = await (supabase as any).functions.invoke('apollo-agent', {
        body: { action: 'list_audiences', targetAccountId: connectedAccount.account_id },
      });
      setAudiences(data?.audiences || []);
    } catch { /* ignore */ } finally {
      setIsLoadingAudiences(false);
    }
  };

  useEffect(() => {
    loadAudiences();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedAccount?.account_id]);

  const handleEstimateReach = async () => {
    if (!connectedAccount?.account_id) {
      toast({ title: 'Sem conta conectada', description: 'Conecte sua conta Meta Ads.', variant: 'destructive' });
      return;
    }
    setIsEstimating(true);
    setEstimateResult(null);
    try {
      const targetingSpec: any = {
        geo_locations: { countries: [estimateCountry] },
        age_min: estimateAge[0],
        age_max: estimateAge[1],
      };
      if (estimateGender !== 'ALL') targetingSpec.genders = [estimateGender === 'MALE' ? 1 : 2];

      const { data } = await (supabase as any).functions.invoke('apollo-agent', {
        body: { action: 'get_audience_insights', targetAccountId: connectedAccount.account_id, targeting_spec: targetingSpec },
      });

      if (data?.users_lower_bound) {
        setEstimateResult({ lower: data.users_lower_bound, upper: data.users_upper_bound });
      } else {
        toast({ title: 'Estimativa indisponível', description: 'A Meta API não retornou uma estimativa. Tente parâmetros diferentes.', variant: 'destructive' });
      }
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsEstimating(false);
    }
  };

  const handleCreateAudience = async () => {
    if (!newAudienceName.trim()) return;
    if (!connectedAccount?.account_id) {
      toast({ title: 'Sem conta conectada', variant: 'destructive' });
      return;
    }
    setIsCreatingAudience(true);
    try {
      const { data } = await (supabase as any).functions.invoke('apollo-agent', {
        body: { action: 'create_custom_audience', targetAccountId: connectedAccount.account_id, name: newAudienceName },
      });
      if (data?.id) {
        toast({ title: 'Público criado!', description: `ID: ${data.id}` });
        setNewAudienceName('');
        loadAudiences();
      }
    } catch (err: any) {
      toast({ title: 'Erro ao criar público', description: err.message, variant: 'destructive' });
    } finally {
      setIsCreatingAudience(false);
    }
  };

  const formatCount = (n: number) => {
    if (!n) return '—';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toLocaleString('pt-BR');
  };

  const filtered = audiences.filter(a => a.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-6">
      {/* Públicos Personalizados */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-orange-400" />
            Públicos Personalizados
            {audiences.length > 0 && (
              <Badge variant="outline" className="text-[10px] bg-orange-500/10 text-orange-400 border-orange-500/30">
                {audiences.length}
              </Badge>
            )}
          </CardTitle>
          <Button size="sm" variant="outline" onClick={loadAudiences} disabled={isLoadingAudiences} className="gap-1.5 h-8 text-xs">
            {isLoadingAudiences ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Atualizar
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {audiences.length > 0 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar público..."
                className="text-sm pl-8 h-8"
              />
            </div>
          )}

          {isLoadingAudiences ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Carregando públicos...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2 text-muted-foreground">
              <Users className="h-8 w-8 opacity-30" />
              <p className="text-sm">{audiences.length === 0 ? 'Nenhum público criado ainda.' : 'Nenhum resultado para a busca.'}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(audience => (
                <div key={audience.id} className="flex items-center gap-3 rounded-lg border border-border/50 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">{audience.name}</p>
                      <Badge variant="outline" className={`text-[10px] ${subtypeBadge(audience.subtype)}`}>
                        {subtypeLabel(audience.subtype)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-[11px] text-muted-foreground">ID: {audience.id}</span>
                      {audience.approximate_count > 0 && (
                        <span className="text-[11px] text-muted-foreground">~{formatCount(audience.approximate_count)} pessoas</span>
                      )}
                      {audience.delivery_status && (
                        <span className={`text-[11px] font-medium ${deliveryStatusColor(audience.delivery_status.code)}`}>
                          {audience.delivery_status.description}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 whitespace-nowrap gap-1 text-orange-400 border-orange-500/30 hover:bg-orange-500/10">
                    <Zap className="h-3 w-3" /> Usar
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Create new audience */}
          <div className="pt-2 border-t border-border/50">
            <p className="text-xs font-medium text-muted-foreground mb-2">Criar público personalizado</p>
            <div className="flex gap-2">
              <Input
                value={newAudienceName}
                onChange={e => setNewAudienceName(e.target.value)}
                placeholder="Nome do público..."
                className="text-sm flex-1 h-8"
              />
              <Button size="sm" onClick={handleCreateAudience} disabled={isCreatingAudience || !newAudienceName.trim()} className="gap-1 bg-orange-500 hover:bg-orange-600 text-white">
                {isCreatingAudience ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Criar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Análise de Alcance */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-orange-400" />
              Analisar Alcance de Público
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">País</Label>
                <Select value={estimateCountry} onValueChange={setEstimateCountry}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BR">Brasil</SelectItem>
                    <SelectItem value="US">Estados Unidos</SelectItem>
                    <SelectItem value="PT">Portugal</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">Gênero</Label>
                <Select value={estimateGender} onValueChange={setEstimateGender}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todos</SelectItem>
                    <SelectItem value="MALE">Masculino</SelectItem>
                    <SelectItem value="FEMALE">Feminino</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">Idade mínima</Label>
                <Input
                  type="number"
                  value={estimateAge[0]}
                  onChange={e => setEstimateAge([parseInt(e.target.value) || 18, estimateAge[1]])}
                  min={18}
                  max={65}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">Idade máxima</Label>
                <Input
                  type="number"
                  value={estimateAge[1]}
                  onChange={e => setEstimateAge([estimateAge[0], parseInt(e.target.value) || 65])}
                  min={18}
                  max={65}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            {estimateResult && (
              <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3">
                <p className="text-[11px] text-muted-foreground mb-1">Alcance estimado mensal</p>
                <p className="text-xl font-bold text-orange-400">
                  {(estimateResult.lower / 1_000_000).toFixed(1)}M — {(estimateResult.upper / 1_000_000).toFixed(1)}M
                </p>
                <p className="text-[11px] text-muted-foreground">pessoas ativas</p>
              </div>
            )}

            <Button size="sm" onClick={handleEstimateReach} disabled={isEstimating} className="w-full gap-2 bg-orange-500 hover:bg-orange-600 text-white">
              {isEstimating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Target className="h-3.5 w-3.5" />}
              {isEstimating ? 'Estimando...' : 'Estimar Alcance'}
            </Button>
          </CardContent>
        </Card>

        {/* Públicos Salvos */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BookMarked className="h-4 w-4 text-orange-400" />
              Segmentos Pré-definidos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {SAVED_SEGMENTS.map(seg => (
                <div
                  key={seg.name}
                  className={`rounded-lg border p-3 space-y-1.5 ${seg.border} ${seg.bg}`}
                >
                  <div className="flex items-center justify-between">
                    <p className={`text-sm font-semibold ${seg.color}`}>{seg.name}</p>
                    <Badge variant="outline" className={`text-[10px] ${seg.border} ${seg.color}`}>
                      {seg.size}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{seg.description}</p>
                  <Button size="sm" variant="outline" className={`h-6 text-[10px] px-2 gap-1 ${seg.color} ${seg.border}`}>
                    <Zap className="h-2.5 w-2.5" />
                    Usar em campanha
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
