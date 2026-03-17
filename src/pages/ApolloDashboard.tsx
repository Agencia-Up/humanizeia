import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { FunnelHealthCard } from '@/components/apollo/FunnelHealthCard';
import { DiagnosticTreeCard } from '@/components/apollo/DiagnosticTreeCard';
import { SmartAlertCard } from '@/components/apollo/SmartAlertCard';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import {
  useApolloAnalyze,
  useApolloHealthScores,
  useApolloDiagnostics,
  useApolloAlerts,
  useApolloRecommendations,
  useApproveRecommendation,
  useDismissAlert,
  useApolloSidebarData,
} from '@/hooks/useApolloData';
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle,
  GitBranch,
  Lightbulb,
  Loader2,
  Play,
  Radar,
  RefreshCw,
  Shield,
  Sparkles,
  ThumbsUp,
  XCircle,
  Zap,
} from 'lucide-react';

const severityColors: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

export default function ApolloDashboard() {
  const analyze = useApolloAnalyze();
  const { data: healthScores } = useApolloHealthScores();
  const { data: diagnosticsRaw } = useApolloDiagnostics();
  const { data: alertsRaw } = useApolloAlerts();
  const { data: recommendations } = useApolloRecommendations();
  const approveRec = useApproveRecommendation();
  const dismissAlert = useDismissAlert();
  const { funnelStages, diagnostics, alerts } = useApolloSidebarData();

  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);

  const handleAnalyze = async () => {
    try {
      const result = await analyze.mutateAsync(undefined);
      if (result?.ai_analysis) {
        setAiAnalysis(result.ai_analysis);
      }
    } catch {
      // error handled by mutation
    }
  };

  const overallScore = healthScores?.length
    ? Math.round(healthScores.reduce((s: number, h: any) => s + h.score, 0) / healthScores.length)
    : null;

  const handleAlertAction = (alertId: string, action: string) => {
    // Could trigger specific actions, for now just dismiss
    dismissAlert.mutate(alertId);
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Radar className="h-6 w-6 text-primary" />
              Apollo — Centro de Diagnóstico
            </h1>
            <p className="text-muted-foreground mt-1">
              Monitoramento, diagnóstico e otimização automática do seu funil
            </p>
          </div>
          <Button
            onClick={handleAnalyze}
            disabled={analyze.isPending}
            className="gap-2"
          >
            {analyze.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {analyze.isPending ? 'Analisando...' : 'Executar Análise'}
          </Button>
        </div>

        {/* Overall Health Score */}
        {overallScore !== null && (
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="pt-6">
              <div className="flex items-center gap-6">
                <div className="flex flex-col items-center">
                  <div className={`text-4xl font-bold ${
                    overallScore >= 80 ? 'text-emerald-400' :
                    overallScore >= 60 ? 'text-amber-400' : 'text-red-400'
                  }`}>
                    {overallScore}
                  </div>
                  <span className="text-xs text-muted-foreground mt-1">Health Score</span>
                </div>
                <div className="flex-1">
                  <Progress
                    value={overallScore}
                    className="h-3"
                  />
                  <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                    <span>0 — Crítico</span>
                    <span>50 — Atenção</span>
                    <span>100 — Saudável</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Badge className={
                    overallScore >= 80 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                    overallScore >= 60 ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
                    'bg-red-500/20 text-red-400 border-red-500/30'
                  }>
                    {overallScore >= 80 ? '✅ Saudável' : overallScore >= 60 ? '⚠️ Atenção' : '🔴 Crítico'}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Visão Geral</TabsTrigger>
            <TabsTrigger value="diagnostics" className="gap-1">
              Diagnósticos
              {diagnosticsRaw?.length ? (
                <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 text-[10px] rounded-full">
                  {diagnosticsRaw.length}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="recommendations" className="gap-1">
              Recomendações
              {recommendations?.length ? (
                <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 text-[10px] rounded-full">
                  {recommendations.length}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="alerts" className="gap-1">
              Alertas
              {alertsRaw?.length ? (
                <Badge variant="destructive" className="ml-1 h-5 w-5 p-0 text-[10px] rounded-full">
                  {alertsRaw.length}
                </Badge>
              ) : null}
            </TabsTrigger>
          </TabsList>

          {/* OVERVIEW TAB */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Funnel Health */}
              {funnelStages.length > 0 ? (
                <FunnelHealthCard stages={funnelStages} overallScore={overallScore ?? undefined} />
              ) : (
                <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                  <CardContent className="flex flex-col items-center py-12 text-center">
                    <Radar className="h-10 w-10 text-muted-foreground mb-3" />
                    <p className="text-sm font-medium">Nenhum dado de saúde</p>
                    <p className="text-xs text-muted-foreground mt-1">Execute uma análise para ver o funil</p>
                  </CardContent>
                </Card>
              )}

              {/* Alerts */}
              <SmartAlertCard alerts={alerts} onAction={handleAlertAction} />
            </div>

            {/* AI Analysis */}
            {aiAnalysis && (
              <Card className="border-primary/30 bg-primary/5 backdrop-blur-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Brain className="h-5 w-5 text-primary" />
                    Análise Apollo AI
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <MarkdownRenderer content={aiAnalysis} />
                </CardContent>
              </Card>
            )}

            {/* Diagnostics Tree */}
            <DiagnosticTreeCard diagnostics={diagnostics} />
          </TabsContent>

          {/* DIAGNOSTICS TAB */}
          <TabsContent value="diagnostics" className="space-y-4">
            {!diagnosticsRaw?.length ? (
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardContent className="flex flex-col items-center py-12 text-center">
                  <Shield className="h-10 w-10 text-emerald-400 mb-3" />
                  <p className="text-sm font-medium text-emerald-400">Nenhum problema detectado</p>
                  <p className="text-xs text-muted-foreground mt-1">Execute uma análise ou aguarde dados de campanhas</p>
                </CardContent>
              </Card>
            ) : (
              diagnosticsRaw.map((diag: any) => (
                <Card key={diag.id} className="border-border/50 bg-card/50 backdrop-blur-sm">
                  <CardContent className="pt-5 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg ${severityColors[diag.severity]}`}>
                          {diag.severity === 'critical' ? <XCircle className="h-4 w-4" /> :
                           diag.severity === 'high' ? <AlertTriangle className="h-4 w-4" /> :
                           <Activity className="h-4 w-4" />}
                        </div>
                        <div>
                          <h3 className="font-medium">{diag.problem}</h3>
                          <p className="text-sm text-muted-foreground mt-1">{diag.diagnosis}</p>
                        </div>
                      </div>
                      <Badge className={severityColors[diag.severity]}>
                        {diag.severity}
                      </Badge>
                    </div>
                    <div className="rounded-lg bg-muted/30 p-3 border border-border/30">
                      <p className="text-xs font-medium text-muted-foreground mb-1">CAUSA RAIZ</p>
                      <p className="text-sm">{diag.cause}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <GitBranch className="h-3 w-3" />
                      <span>Estágio: {diag.stage}</span>
                      <span>•</span>
                      <span>Categoria: {diag.category}</span>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* RECOMMENDATIONS TAB */}
          <TabsContent value="recommendations" className="space-y-4">
            {!recommendations?.length ? (
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardContent className="flex flex-col items-center py-12 text-center">
                  <Lightbulb className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="text-sm font-medium">Nenhuma recomendação pendente</p>
                  <p className="text-xs text-muted-foreground mt-1">Execute uma análise para receber recomendações</p>
                </CardContent>
              </Card>
            ) : (
              recommendations.map((rec: any) => (
                <Card key={rec.id} className="border-border/50 bg-card/50 backdrop-blur-sm">
                  <CardContent className="pt-5">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Zap className="h-4 w-4 text-primary" />
                          <h3 className="font-medium">{rec.title}</h3>
                          <Badge variant="outline" className="text-[10px]">
                            Prioridade {rec.priority}/10
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{rec.description}</p>
                        {rec.impact_estimate && (
                          <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
                            <Sparkles className="h-3 w-3" />
                            Impacto estimado: {rec.impact_estimate}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2 ml-4">
                        {rec.status === 'pending' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => approveRec.mutate(rec.id)}
                            disabled={approveRec.isPending}
                          >
                            <ThumbsUp className="h-3 w-3 mr-1" />
                            Aprovar
                          </Button>
                        )}
                        {rec.status === 'approved' && (
                          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Aprovado
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* ALERTS TAB */}
          <TabsContent value="alerts" className="space-y-4">
            <SmartAlertCard alerts={alerts} onAction={handleAlertAction} />
          </TabsContent>
        </Tabs>

        {/* How it works */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              Como o Apollo funciona
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className="gap-1"><Activity className="h-3 w-3" /> Monitora</Badge>
              <span className="text-muted-foreground">→</span>
              <Badge variant="outline" className="gap-1"><GitBranch className="h-3 w-3" /> Diagnostica</Badge>
              <span className="text-muted-foreground">→</span>
              <Badge variant="outline" className="gap-1"><Lightbulb className="h-3 w-3" /> Prescreve</Badge>
              <span className="text-muted-foreground">→</span>
              <Badge variant="outline" className="gap-1"><Zap className="h-3 w-3" /> Executa</Badge>
              <span className="text-muted-foreground">→</span>
              <Badge variant="outline" className="gap-1"><Brain className="h-3 w-3" /> Aprende</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
