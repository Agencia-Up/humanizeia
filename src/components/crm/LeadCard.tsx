import { memo } from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DollarSign, Mail, Phone, Building2, GripVertical } from 'lucide-react';
import type { CRMLead } from '@/hooks/useFluxCRM';

interface LeadCardProps {
  lead: CRMLead;
  index: number;
  onClick: (lead: CRMLead) => void;
}

const priorityColors: Record<string, string> = {
  high: 'bg-destructive/10 text-destructive border-destructive/20',
  medium: 'bg-warning/10 text-warning border-warning/20',
  low: 'bg-muted text-muted-foreground border-border',
};

const priorityLabels: Record<string, string> = {
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};

export const LeadCard = memo(function LeadCard({ lead, index, onClick }: LeadCardProps) {
  return (
    <Draggable draggableId={lead.id} index={index}>
      {(provided, snapshot) => (
        <Card
          ref={provided.innerRef}
          {...provided.draggableProps}
          onClick={() => onClick(lead)}
          className={`p-3 mb-2 cursor-pointer border border-border/60 transition-all hover:shadow-md hover:border-primary/30 ${
            snapshot.isDragging ? 'shadow-lg ring-2 ring-primary/20 rotate-1' : ''
          }`}
        >
          <div className="flex items-start gap-2">
            <div {...provided.dragHandleProps} className="mt-1 text-muted-foreground/40 hover:text-muted-foreground">
              <GripVertical className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-foreground truncate">{lead.name}</p>

              {lead.company && (
                <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                  <Building2 className="h-3 w-3 shrink-0" />
                  <span className="truncate">{lead.company}</span>
                </div>
              )}

              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {lead.value > 0 && (
                  <span className="flex items-center gap-0.5 text-xs font-semibold text-success">
                    <DollarSign className="h-3 w-3" />
                    {lead.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </span>
                )}
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${priorityColors[lead.priority] || ''}`}>
                  {priorityLabels[lead.priority] || lead.priority}
                </Badge>
              </div>

              {(lead.email || lead.phone) && (
                <div className="flex items-center gap-2 mt-1.5">
                  {lead.email && <Mail className="h-3 w-3 text-muted-foreground/50" />}
                  {lead.phone && <Phone className="h-3 w-3 text-muted-foreground/50" />}
                </div>
              )}

              {lead.tags && lead.tags.length > 0 && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {lead.tags.slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                      {tag}
                    </Badge>
                  ))}
                  {lead.tags.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">+{lead.tags.length - 3}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}
    </Draggable>
  );
});
