import { FunnelHealthCard, type FunnelStage } from './FunnelHealthCard';
import { SmartAlertCard, type SmartAlert } from './SmartAlertCard';
import { DiagnosticTreeCard, type DiagnosticNode } from './DiagnosticTreeCard';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PanelRightClose, PanelRightOpen, Radar } from 'lucide-react';

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
  funnelStages = [], 
  alerts = [], 
  diagnostics = [],
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

  const hasData = funnelStages.length > 0 || alerts.length > 0 || diagnostics.length > 0;

  return (
    <div className="w-80 border-l border-border/50 bg-card/30 backdrop-blur-sm flex flex-col shrink-0">
      <div className="flex items-center justify-between p-3 border-b border-border/50">
        <span className="text-sm font-semibold">Painel de Diagnóstico</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggle}>
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1 p-3">
        {!hasData ? (
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted/50 mb-4">
                <Radar className="h-7 w-7 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">Nenhuma campanha ativa</p>
              <p className="text-xs text-muted-foreground max-w-[220px]">
                Conecte suas contas de anúncios e tenha campanhas em execução para que o Apollo possa diagnosticar e otimizar seu funil automaticamente.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {funnelStages.length > 0 && <FunnelHealthCard stages={funnelStages} />}
            <SmartAlertCard alerts={alerts} onAction={onAlertAction} />
            {diagnostics.length > 0 && <DiagnosticTreeCard diagnostics={diagnostics} />}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}