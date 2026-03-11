import { useState, useCallback } from 'react';
import { AlertTriangle, Lightbulb, CheckCircle, Info, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { motion } from 'framer-motion';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import { useMetaInsights } from '@/hooks/useMetaInsights';
import { useMetaConnection } from '@/hooks/useMetaConnection';

interface AIInsight {
  id: string;
  type: 'warning' | 'opportunity' | 'success' | 'info';
  title: string;
  description: string;
  impact?: string;
}

interface AIInsightsCardProps {
  insights: AIInsight[];
}

const insightIcons = { warning: AlertTriangle, opportunity: Lightbulb, success: CheckCircle, info: Info };
const insightColors = {
  warning: 'bg-warning/10 text-warning border-warning/30',
  opportunity: 'bg-primary/10 text-primary border-primary/30',
  success: 'bg-success/10 text-success border-success/30',
  info: 'bg-muted text-muted-foreground border-border',
};
const badgeColors = {
  warning: 'bg-warning/20 text-warning hover:bg-warning/30',
  opportunity: 'bg-primary/20 text-primary hover:bg-primary/30',
  success: 'bg-success/20 text-success hover:bg-success/30',
  info: 'bg-muted text-muted-foreground hover:bg-muted',
};

export function AIInsightsCard({ insights: initialInsights }: AIInsightsCardProps) {
  const [insights, setInsights] = useState<AIInsight[]>(initialInsights);
  const [isGenerating, setIsGenerating] = useState(false);
  const { connectedAccount } = useMetaConnection();

  const { data: accountData } = useMetaInsights({
    accountId: connectedAccount?.account_id,
    datePreset: 'last_7d',
    fields: 'spend,impressions,clicks,ctr,actions,action_values',
    enabled: !!connectedAccount,
  });

  const { sendSingleMessage } = useClaudeChat({
    context: 'insights',
    onError: (error) => console.error('Insights error:', error),
  });

  const generateInsights = useCallback(async () => {
    setIsGenerating(true);
    const raw = accountData?.data?.[0] || accountData?.[0];
    const prompt = `Analise e gere 4-5 insights em JSON. Dados Meta Ads: spend=${raw?.spend || 0}, impressions=${raw?.impressions || 0}, clicks=${raw?.clicks || 0}, ctr=${raw?.ctr || 0}`;

    try {
      const response = await sendSingleMessage(prompt);
      try {
        const parsed = JSON.parse(response);
        if (parsed.insights && Array.isArray(parsed.insights)) {
          setInsights(parsed.insights.map((i: any, idx: number) => ({
            id: `ai-${Date.now()}-${idx}`, type: i.type || 'info', title: i.title || 'Insight', description: i.description || '', impact: i.impact,
          })));
        }
      } catch { /* keep original */ }
    } catch { /* ignore */ } finally { setIsGenerating(false); }
  }, [sendSingleMessage, accountData]);

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary"><Lightbulb className="h-4 w-4 text-white" /></div>
          AI Insights
          <Badge variant="secondary" className="ml-auto">{insights.length} novos</Badge>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={generateInsights} disabled={isGenerating}>
            <RefreshCw className={`h-4 w-4 ${isGenerating ? 'animate-spin' : ''}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[280px] pr-4">
          {isGenerating ? (
            <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="rounded-lg border p-3"><Skeleton className="h-12 w-full" /></div>)}</div>
          ) : (
            <div className="space-y-3">
              {insights.map((insight, index) => {
                const Icon = insightIcons[insight.type];
                return (
                  <motion.div key={insight.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.1 }}
                    className={`rounded-lg border p-3 transition-all hover:shadow-md ${insightColors[insight.type]}`}>
                    <div className="flex items-start gap-3">
                      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                      <div className="flex-1 space-y-1">
                        <p className="font-medium">{insight.title}</p>
                        <p className="text-sm opacity-80">{insight.description}</p>
                        {insight.impact && <Badge className={badgeColors[insight.type]}>{insight.impact}</Badge>}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
