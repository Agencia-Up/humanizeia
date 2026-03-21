import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, AlertOctagon, Info, TrendingUp, TrendingDown, CheckCircle, HelpCircle } from 'lucide-react';
import type { Anomaly } from '@/hooks/useMetaDashboard';

// Glossário de métricas com explicação detalhada
const metricGlossary: Record<string, { sigla: string; nome: string; descricao: string; dica: string }> = {
  cpc: {
    sigla: 'CPC',
    nome: 'Custo por Clique',
    descricao: 'Quanto você paga em média cada vez que alguém clica no seu anúncio.',
    dica: '💡 Quanto menor o CPC, mais eficiente é o seu anúncio. Um CPC alto pode indicar público muito disputado ou criativo pouco atrativo.',
  },
  cpm: {
    sigla: 'CPM',
    nome: 'Custo por Mil Impressões',
    descricao: 'Quanto custa exibir seu anúncio 1.000 vezes para o público.',
    dica: '💡 CPM alto pode indicar público muito concorrido ou período de alto volume de anúncios (ex: datas comemorativas).',
  },
  cpa: {
    sigla: 'CPA',
    nome: 'Custo por Aquisição',
    descricao: 'Quanto você paga em média por cada resultado obtido (compra, lead, cadastro, etc).',
    dica: '💡 Compare o CPA com o valor do seu produto/serviço. Se o CPA for maior que o lucro por venda, a campanha está no prejuízo.',
  },
  ctr: {
    sigla: 'CTR',
    nome: 'Taxa de Cliques',
    descricao: 'Porcentagem de pessoas que viram o anúncio e clicaram nele.',
    dica: '💡 CTR baixo geralmente indica que o criativo (imagem/vídeo/texto) não está atraindo a atenção do público. Tente novos formatos.',
  },
  roas: {
    sigla: 'ROAS',
    nome: 'Retorno sobre Investimento em Anúncios',
    descricao: 'Quanto retorna em receita para cada R$1 investido em anúncios.',
    dica: '💡 Ex: ROAS 3x = para cada R$1 gasto em anúncio, você gerou R$3 em vendas. Abaixo de 1x significa prejuízo direto.',
  },
  gasto: {
    sigla: '',
    nome: 'Investimento',
    descricao: 'Total gasto em anúncios no período selecionado.',
    dica: '💡 Compare com o período anterior para entender tendências de consumo do orçamento.',
  },
  impressoes: {
    sigla: '',
    nome: 'Impressões',
    descricao: 'Número total de vezes que seus anúncios foram exibidos.',
    dica: '💡 Uma impressão não significa que o usuário prestou atenção — apenas que o anúncio apareceu na tela.',
  },
  cliques: {
    sigla: '',
    nome: 'Cliques',
    descricao: 'Número total de cliques recebidos nos seus anúncios.',
    dica: '💡 Combine com o CTR para entender se os cliques são proporcionais ao alcance.',
  },
};

interface AnomalyAlertsWidgetProps {
  anomalies: Anomaly[];
}

const iconMap = {
  danger: AlertOctagon,
  warning: AlertTriangle,
  info: Info,
};

const styleMap = {
  danger: {
    border: 'border-destructive/30',
    bg: 'bg-destructive/5',
    badge: 'bg-destructive/10 text-destructive border-destructive/20',
    icon: 'text-destructive',
    label: 'Crítico',
  },
  warning: {
    border: 'border-warning/30',
    bg: 'bg-warning/5',
    badge: 'bg-warning/10 text-warning border-warning/20',
    icon: 'text-warning',
    label: 'Atenção',
  },
  info: {
    border: 'border-primary/30',
    bg: 'bg-primary/5',
    badge: 'bg-primary/10 text-primary border-primary/20',
    icon: 'text-primary',
    label: 'Destaque',
  },
};

export function AnomalyAlertsWidget({ anomalies }: AnomalyAlertsWidgetProps) {
  if (anomalies.length === 0) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="flex items-center gap-3 p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success/10">
            <CheckCircle className="h-5 w-5 text-success" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Tudo normal! ✨</p>
            <p className="text-xs text-muted-foreground">
              Nenhuma variação significativa detectada em relação ao período anterior.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <AlertTriangle className="h-5 w-5 text-warning" />
          Alertas de Performance
          <Badge variant="outline" className="ml-auto text-xs">
            {anomalies.length} {anomalies.length === 1 ? 'alerta' : 'alertas'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <AnimatePresence>
          {anomalies.map((anomaly, i) => {
            const style = styleMap[anomaly.type];
            const Icon = iconMap[anomaly.type];
            const TrendIcon = anomaly.changePercent > 0 ? TrendingUp : TrendingDown;

            const glossary = metricGlossary[anomaly.metric];

            return (
              <motion.div
                key={anomaly.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08 }}
                className={`flex items-start gap-3 rounded-lg border p-3 ${style.border} ${style.bg}`}
              >
                <div className={`mt-0.5 shrink-0 ${style.icon}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {glossary ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button className="flex items-center gap-1.5 group/tip cursor-help text-left">
                            <p className="text-sm font-medium text-foreground group-hover/tip:text-primary transition-colors">
                              {anomaly.title}
                            </p>
                            <HelpCircle className="h-3.5 w-3.5 text-muted-foreground group-hover/tip:text-primary transition-colors shrink-0" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-72 p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            {glossary.sigla && (
                              <span className="rounded bg-primary/20 px-1.5 py-0.5 text-xs font-bold text-primary">
                                {glossary.sigla}
                              </span>
                            )}
                            <span className="text-sm font-semibold">{glossary.nome}</span>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{glossary.descricao}</p>
                          <p className="text-xs leading-relaxed border-t border-border pt-2">{glossary.dica}</p>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <p className="text-sm font-medium text-foreground">{anomaly.title}</p>
                    )}
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${style.badge}`}>
                      {style.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{anomaly.description}</p>
                </div>
                <div className={`flex items-center gap-1 shrink-0 text-xs font-medium ${style.icon}`}>
                  <TrendIcon className="h-3 w-3" />
                  <span>{anomaly.changePercent > 0 ? '+' : ''}{anomaly.changePercent.toFixed(0)}%</span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
