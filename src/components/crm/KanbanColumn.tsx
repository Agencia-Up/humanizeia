import { memo } from 'react';
import { Droppable } from '@hello-pangea/dnd';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { LeadCard } from './LeadCard';
import type { CRMLead, PipelineStage } from '@/hooks/useFluxCRM';

interface KanbanColumnProps {
  stage: PipelineStage;
  leads: CRMLead[];
  onAddLead: (stageId: string) => void;
  onClickLead: (lead: CRMLead) => void;
}

export const KanbanColumn = memo(function KanbanColumn({ stage, leads, onAddLead, onClickLead }: KanbanColumnProps) {
  const totalValue = leads.reduce((s, l) => s + (l.value || 0), 0);

  return (
    <div className="flex flex-col min-w-[280px] max-w-[320px] w-full shrink-0 h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 rounded-t-lg" style={{ backgroundColor: stage.color + '18' }}>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
          <span className="font-semibold text-sm text-foreground">{stage.name}</span>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{leads.length}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onAddLead(stage.id)}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Value summary */}
      {totalValue > 0 && (
        <div className="px-3 py-1 text-xs text-muted-foreground bg-muted/30 border-x border-border/40">
          Total: {totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
        </div>
      )}

      {/* Cards */}
      <Droppable droppableId={stage.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 p-2 space-y-0 min-h-[120px] overflow-y-auto rounded-b-lg border border-border/40 transition-colors ${
              snapshot.isDraggingOver ? 'bg-primary/5 border-primary/20' : 'bg-card/50'
            }`}
          >
            {leads.map((lead, i) => (
              <LeadCard key={lead.id} lead={lead} index={i} onClick={onClickLead} />
            ))}
            {provided.placeholder}
            {leads.length === 0 && !snapshot.isDraggingOver && (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50">
                <p className="text-xs">Arraste leads aqui</p>
              </div>
            )}
          </div>
        )}
      </Droppable>
    </div>
  );
});
