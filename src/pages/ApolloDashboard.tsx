import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useApolloEngine, DiagnosticResult, Diagnostic, Recommendation } from '@/hooks/useApolloEngine';
import { 
  Activity, AlertTriangle, CheckCircle, RefreshCw, Zap, TrendingUp, 
  TrendingDown, Minus, Brain, ArrowRight, ShieldCheck 
} from 'lucide-react';

export default function ApolloDashboard() {
  const { isAnalyzing, dashboardData, runDiagnostic, loadDashboard, executeRecommendation } = useApolloEngine();
  const [lastDiag, setLastDiag] = useState<DiagnosticResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [showManualDialog, setShowManualDialog] = useState(false);
  const [manualMetrics, setManualMetrics] = useState({ ctr: '', cpa: '', cpm: '', roas: '', frequency: '' });

  useEffect(() => {
    loadDashboard().finally(() => setLoading(false));
  }, []);

  const handleRunDiagnostic = async () => {
    const result = await runDiagnostic();
    if (result) {
      setLastDiag(result);
      await loadDashboard();
    }
  };

  const handleManualDiagnostic = async () => {
    const metrics: Record<string, number> = {};
    if (manualMetrics.ctr) metrics.ctr = parseFloat(manualMetrics.ctr);
    if (manualMetrics.cpa) metrics.cpa = parseFloat(manualMetrics.cpa);
    if (manualMetrics.cpm) metrics.cpm = parseFloat(manualMetrics.cpm);
    if (manualMetrics.roas) metrics.roas = parseFloat(manualMetrics.roas);
    if (manualMetrics.frequency) metrics.frequency = parseFloat(manualMetrics.frequency);

    if (Object.keys(metrics).length === 0) return;

    const result = await runDiagnostic(undefined, metrics);
    if (result) {
      setLastDiag(result);
      setShowManualDialog(false);
      await loadDashboard();
    }
  };

  const latestScore = dashboardData?.health_scores?.[0];
  const openDiags = dashboardData?.diagnostics || [];
  const pendingRecs = dashboardData?.recommendations || [];
  const alerts = dashboardData?.alerts || [];

  const scoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-500';
    if (score >= 60) return 'text-amber-500';
    if (score >= 40) return 'text-orange-500';
    return 'text-destructive';
  };

  const scoreBg = (score: number) => {
    if (score >= 80) return 'from-emerald-500/20 to-emerald-500/5';
    if (score >= 60) return 'from-amber-500/20 to-amber-500/5';
    if (score >= 40) return 'from-orange-500/20 to-orange-500/5';
    return 'from-destructive/20 to-destructive/5';
  };

  const trendIcon = (trend: string | null) => {
    if (trend === 'up') return <TrendingUp className="h-4 w-4 text-emerald-500" />;
    if (trend === 'down') return <TrendingDown className="h-4 w-4 text-destructive" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  const severityBadge = (severity: string) => {
    const map: Record<string, 'destructive' | 'default' | 'secondary' | 'outline'> = {
      critical: 'destructive',
      high: 'destructive',
      medium: 'default',
      low: 'secondary',
    };
    return <Badge variant={map[severity] || 'outline'}>{severity}</Badge>;
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
              <Brain className="w-7 h-7 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold lg:text-3xl">Apollo Diagnóstico</h1>
              <p className="text-muted-foreground">Motor de análise e diagnóstico inteligente</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Dialog open={showManualDialog} onOpenChange={setShowManualDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">Diagnóstico Manual</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Diagnóstico Manual</DialogTitle>
                  <DialogDescription>Insira métricas para análise diagnóstica.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>CTR (%)</Label><Input type="number" step="0.1" placeholder="1.5" value={manualMetrics.ctr} onChange={e => setManualMetrics(p => ({ ...p, ctr: e.target.value }))} /></div>
                    <div><Label>CPA (R$)</Label><Input type="number" placeholder="50" value={manualMetrics.cpa} onChange={e => setManualMetrics(p => ({ ...p, cpa: e.target.value }))} /></div>
                    <div><Label>CPM (R$)</Label><Input type="number" placeholder="25" value={manualMetrics.cpm} onChange={e => setManualMetrics(p => ({ ...p, cpm: e.target.value }))} /></div>
                    <div><Label>ROAS</Label><Input type="number" step="0.1" placeholder="3.0" value={manualMetrics.roas} onChange={e => setManualMetrics(p => ({ ...p, roas: e.target.value }))} /></div>
                    <div><Label>Frequência</Label><Input type="number" step="0.1" placeholder="2.0" value={manualMetrics.frequency} onChange={e => setManualMetrics(p => ({ ...p, frequency: e.target.value }))} /></div>
                  </div>
                  <Button onClick={handleManualDiagnostic} disabled={isAnalyzing} className="w-full">
                    {isAnalyzing ? 'Analisando...' : 'Rodar Diagnóstico'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            <Button size="sm" onClick={handleRunDiagnostic} disabled={isAnalyzing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
              {isAnalyzing ? 'Analisando...' : 'Rodar Diagnóstico'}
            </Button>
          </div>
        </div>

        {/* Health Score Card */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="md:col-span-2">
            <CardContent className="p-6">
              {latestScore ? (
                <div className="flex items-center gap-6">
                  <div className={`w-24 h-24 rounded-full bg-gradient-to-br ${scoreBg(latestScore.score)} flex items-center justify-center`}>
                    <span className={`text-3xl font-bold ${scoreColor(latestScore.score)}`}>{latestScore.score}</span>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Health Score</p>
                    <div className="flex items-center gap-2 mt-1">
                      {trendIcon(latestScore.trend)}
                      <span className="text-sm">
                        {latestScore.previous_score !== null && `Anterior: ${latestScore.previous_score}`}
                      </span>
                    </div>
                    <Badge variant="outline" className="mt-2 capitalize">{latestScore.stage}</Badge>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4">
                  <ShieldCheck className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground">Nenhum diagnóstico ainda. Rode a primeira análise.</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 flex items-center gap-4">
              <div className="rounded-lg bg-amber-500/10 p-3"><AlertTriangle className="h-5 w-5 text-amber-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Problemas</p>
                <p className="text-2xl font-bold">{openDiags.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 flex items-center gap-4">
              <div className="rounded-lg bg-blue-500/10 p-3"><Zap className="h-5 w-5 text-blue-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Ações</p>
                <p className="text-2xl font-bold">{pendingRecs.length}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="diagnostics" className="space-y-4">
          <TabsList>
            <TabsTrigger value="diagnostics" className="gap-2"><AlertTriangle className="h-4 w-4" />Diagnósticos</TabsTrigger>
            <TabsTrigger value="recommendations" className="gap-2"><Zap className="h-4 w-4" />Recomendações</TabsTrigger>
            <TabsTrigger value="history" className="gap-2"><Activity className="h-4 w-4" />Histórico</TabsTrigger>
          </TabsList>

          <TabsContent value="diagnostics">
            <div className="space-y-3">
              {openDiags.length === 0 ? (
                <Card className="p-8 text-center">
                  <CheckCircle className="h-12 w-12 mx-auto text-emerald-500/50 mb-4" />
                  <p className="text-muted-foreground">Nenhum problema detectado. Suas campanhas estão saudáveis!</p>
                </Card>
              ) : openDiags.map(diag => (
                <Card key={diag.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {severityBadge(diag.severity)}
                          <Badge variant="outline" className="capitalize">{diag.stage}</Badge>
                          {diag.category && <Badge variant="secondary" className="text-xs">{diag.category}</Badge>}
                        </div>
                        <p className="font-medium">{diag.problem}</p>
                        <p className="text-sm text-muted-foreground mt-1">{diag.cause}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="recommendations">
            <div className="space-y-3">
              {pendingRecs.length === 0 ? (
                <Card className="p-8 text-center">
                  <Zap className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">Nenhuma recomendação pendente.</p>
                </Card>
              ) : pendingRecs.map(rec => (
                <Card key={rec.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">P{rec.priority || 5}</Badge>
                          <span className="text-xs text-muted-foreground">{rec.action_type}</span>
                        </div>
                        <p className="font-medium">{rec.title}</p>
                        <p className="text-sm text-muted-foreground mt-1">{rec.description}</p>
                        {rec.impact_estimate && (
                          <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                            <TrendingUp className="h-3 w-3" /> {rec.impact_estimate}
                          </p>
                        )}
                      </div>
                      <Button size="sm" variant="outline" onClick={() => executeRecommendation(rec.id)}>
                        <CheckCircle className="h-4 w-4 mr-1" /> Aplicado
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="history">
            <div className="space-y-3">
              {(dashboardData?.health_scores || []).map(hs => (
                <Card key={hs.id}>
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${scoreBg(hs.score)} flex items-center justify-center`}>
                      <span className={`text-lg font-bold ${scoreColor(hs.score)}`}>{hs.score}</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Score: {hs.score}</span>
                        {trendIcon(hs.trend)}
                      </div>
                      <p className="text-xs text-muted-foreground capitalize">Estágio: {hs.stage}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(hs.calculated_at).toLocaleDateString('pt-BR')}
                    </p>
                  </CardContent>
                </Card>
              ))}
              {(!dashboardData?.health_scores || dashboardData.health_scores.length === 0) && (
                <Card className="p-8 text-center">
                  <Activity className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">Nenhum histórico de diagnóstico.</p>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
