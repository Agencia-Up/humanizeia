import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertTriangle, XCircle, Sparkles, Loader2 } from 'lucide-react';
import type { CreativeInsight } from '@/utils/generateCreativeScore';

interface CreativeScoreDisplayProps {
  score: number;
  insights: CreativeInsight[];
  isAnalyzing: boolean;
}

function getScoreColor(score: number) {
  if (score <= 40) return { stroke: '#EF4444', bg: 'bg-red-500/10', text: 'text-red-500', label: 'Baixo' };
  if (score <= 70) return { stroke: '#F59E0B', bg: 'bg-amber-500/10', text: 'text-amber-500', label: 'Moderado' };
  return { stroke: '#22C55E', bg: 'bg-green-500/10', text: 'text-green-500', label: 'Excelente' };
}

const insightIcons = {
  positive: CheckCircle,
  warning: AlertTriangle,
  negative: XCircle,
};

const insightColors = {
  positive: 'text-green-500',
  warning: 'text-amber-500',
  negative: 'text-red-500',
};

const insightBadgeVariants = {
  positive: 'bg-green-500/10 text-green-500 border-green-500/20',
  warning: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  negative: 'bg-red-500/10 text-red-500 border-red-500/20',
};

// SVG circular gauge
function ScoreGauge({ score, isAnalyzing }: { score: number; isAnalyzing: boolean }) {
  const size = 140;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const { stroke, text, label } = getScoreColor(score);

  return (
    <div className="relative flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted/30"
        />
        {/* Progress circle */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={isAnalyzing ? 'hsl(var(--muted-foreground))' : stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: isAnalyzing ? circumference : circumference - progress }}
          transition={{ duration: 1.2, ease: 'easeOut', delay: 0.3 }}
        />
      </svg>
      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <AnimatePresence mode="wait">
          {isAnalyzing ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </motion.div>
          ) : (
            <motion.div
              key="score"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.6 }}
              className="flex flex-col items-center"
            >
              <span className={`text-3xl font-bold ${text}`}>{score}</span>
              <span className={`text-xs font-medium ${text}`}>{label}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function CreativeScoreDisplay({ score, insights, isAnalyzing }: CreativeScoreDisplayProps) {
  const { bg } = getScoreColor(score);

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          Pre-Flight Check
          <Badge variant="outline" className="ml-auto text-[10px] font-normal">
            MIRIAM
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Pontuação preditiva de performance do criativo
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Score Gauge */}
        <div className="flex justify-center">
          <ScoreGauge score={score} isAnalyzing={isAnalyzing} />
        </div>

        {/* Insights List */}
        <AnimatePresence>
          {!isAnalyzing && insights.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.8 }}
              className="space-y-2"
            >
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Insights da IA
              </p>
              <div className="space-y-1.5">
                {insights.map((insight, index) => {
                  const Icon = insightIcons[insight.type];
                  return (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: 1 + index * 0.1 }}
                      className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${insightBadgeVariants[insight.type]}`}
                    >
                      <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${insightColors[insight.type]}`} />
                      <span className="text-xs leading-relaxed text-foreground">
                        {insight.text}
                      </span>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Analyzing state */}
        {isAnalyzing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-2 py-4"
          >
            <p className="text-sm text-muted-foreground">Analisando criativo...</p>
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-primary"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1, delay: i * 0.2, repeat: Infinity }}
                />
              ))}
            </div>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}
