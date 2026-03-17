import { useState } from 'react';
import { FunnelHealthCard, type FunnelStage } from './FunnelHealthCard';
import { SmartAlertCard, type SmartAlert } from './SmartAlertCard';
import { DiagnosticTreeCard, type DiagnosticNode } from './DiagnosticTreeCard';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';

// Mock data for demonstration — will be replaced with real data from API
const mockFunnelStages: FunnelStage[] = [
  { name: 'Impressões → Cliques', score: 78, metric: 'CTR', value: '1.8%', benchmark: '> 1.5%', icon: 'impressions' },
  { name: 'Cliques → Leads', score: 45, metric: 'Conv. LP', value: '12%', benchmark: '> 25%', icon: 'leads' },
  { name: 'Leads → Vendas', score: 62, metric: 'Fechamento', value: '4.2%', benchmark: '> 5%', icon: 'sales' },
  { name: 'Pós-Venda', score: 85, metric: 'Retenção', value: '92%', benchmark: '> 95%', icon: 'retention' },
];

const mockAlerts: SmartAlert[] = [
  {
    id: '1',
    level: 'critical',
    title: 'CPL acima do limite',
    description: 'Custo por lead subiu 40% nos últimos 3 dias. Possível fadiga de criativo.',
    metric: 'CPL',
    currentValue: 'R$ 42,00',
    benchmark: 'R$ 15,00',
    deviation: '+180%',
    actions: ['Pausar criativos', 'Ver detalhes'],
    timestamp: new Date(),
  },
  {
    id: '2',
    level: 'warning',
    title: 'Frequência alta',
    description: 'Conjunto "LAL Compradores" com frequência 4.2. Público saturado.',
    metric: 'Frequência',
    currentValue: '4.2',
    benchmark: '< 3.0',
    deviation: '+40%',
    actions: ['Expandir público'],
    timestamp: new Date(),
  },
];

const mockDiagnostics: DiagnosticNode[] = [
  {
    problem: 'CTR caindo + CPL subindo',
    diagnosis: 'Fadiga de criativo',
    cause: 'Mesmo criativo ativo há 12 dias com frequência > 3.5',
    severity: 'high',
    recommendations: ['Pausar criativos saturados', 'Ativar criativos de backup', 'Testar ângulo: depoimento + resultado'],
  },
  {
    problem: 'Taxa de conversão LP baixa',
    diagnosis: 'Desalinhamento criativo/LP',
    cause: 'Formulário com 8 campos reduz completions',
    severity: 'medium',
    recommendations: ['Reduzir formulário para 3 campos', 'Teste A/B de headline'],
    resolved: false,
  },
];

interface ApolloSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  funnelStages?: FunnelStage[];
  alerts?: SmartAlert[];
  diagnostics?: DiagnosticNode[];
  onAlertAction?: (alertId: string, action: string) => void;
}

export function ApolloSidebar({ 
  isOpen, 
  onToggle, 
  funnelStages = mockFunnelStages, 
  alerts = mockAlerts, 
  diagnostics = mockDiagnostics,
  onAlertAction,
}: ApolloSidebarProps) {
  if (!isOpen) {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggle}
        className="fixed right-4 top-20 z-30 h-9 w-9 rounded-full border border-border/50 bg-card/80 backdrop-blur-sm shadow-md"
      >
        <PanelRightOpen className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <div className="w-80 border-l border-border/50 bg-card/30 backdrop-blur-sm flex flex-col shrink-0">
      <div className="flex items-center justify-between p-3 border-b border-border/50">
        <span className="text-sm font-semibold">Painel de Diagnóstico</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggle}>
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1 p-3">
        <div className="space-y-4">
          <FunnelHealthCard stages={funnelStages} />
          <SmartAlertCard alerts={alerts} onAction={onAlertAction} />
          <DiagnosticTreeCard diagnostics={diagnostics} />
        </div>
      </ScrollArea>
    </div>
  );
}
