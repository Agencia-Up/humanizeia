import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Brain, MessageSquare, Phone, Mail, Kanban, History, Zap, Edit3 } from 'lucide-react';
import LeadTimeline from './LeadTimeline';
import { CRMLead } from '@/hooks/useFluxCRM';

interface LeadDetailModalProps {
  lead: CRMLead | null;
  stages: any[];
  open: boolean;
  onClose: () => void;
  onEdit: (lead: CRMLead) => void;
}

const LeadDetailModal = ({ lead, stages, open, onClose, onEdit }: LeadDetailModalProps) => {
  const currentStage = React.useMemo(() => {
    if (!lead || !stages) return null;
    return stages.find(s => s.id === lead.stage_id);
  }, [lead, stages]);

  if (!lead) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl bg-[#0a0a0b] border-white/5 text-white p-0 overflow-hidden glass-morphism">
        <div className="flex flex-col h-[650px]">
          {/* Header Section */}
          <div className="p-6 border-b border-white/5 bg-gradient-to-r from-purple-500/10 to-transparent">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold tracking-tight">{lead.name}</h2>
                  <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">
                    {lead.company || 'Pessoa Física'}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> {lead.email || 'N/A'}</span>
                  <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {lead.phone || 'N/A'}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="border-white/10 hover:bg-white/5 text-xs h-8"
                  onClick={() => onEdit(lead)}
                >
                  <Edit3 className="w-3.5 h-3.5 mr-1.5" /> Editar
                </Button>
                <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-xs h-8">
                  <Zap className="w-3.5 h-3.5 mr-1.5" /> Ação Salomão
                </Button>
              </div>
            </div>
            
            <div className="flex items-center gap-4 mt-6">
                <div className="px-3 py-1 rounded-full bg-white/5 border border-white/10 flex items-center gap-2">
                    <Kanban className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase">Etapa:</span>
                    <span className="text-[10px] font-bold text-white uppercase tracking-wider">
                        {currentStage?.name || 'Sem Etapa'}
                    </span>
                </div>
                <div className="px-3 py-1 rounded-full bg-white/5 border border-white/10 flex items-center gap-2">
                    <History className="w-3.5 h-3.5 text-purple-400" />
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase">Lead Score:</span>
                    <span className="text-[10px] font-bold text-white uppercase tracking-wider">85/100</span>
                </div>
            </div>
          </div>

          {/* Tabs Content */}
          <Tabs defaultValue="timeline" className="flex-1 flex flex-col min-h-0">
            <div className="px-6 border-b border-white/5">
              <TabsList className="bg-transparent border-b-0 h-12 p-0 gap-6">
                <TabsTrigger value="timeline" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-purple-500 rounded-none h-full px-0 text-xs font-semibold">
                  <History className="w-3.5 h-3.5 mr-2" /> Timeline Unificada
                </TabsTrigger>
                <TabsTrigger value="intelligence" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-purple-500 rounded-none h-full px-0 text-xs font-semibold">
                  <Brain className="w-3.5 h-3.5 mr-2" /> Inteligência Salomão
                </TabsTrigger>
                <TabsTrigger value="followup" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-purple-500 rounded-none h-full px-0 text-xs font-semibold">
                  <MessageSquare className="h-3.5 h-3.5 mr-2" /> Follow-ups
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 p-6 overflow-hidden">
              <TabsContent value="timeline" className="m-0 h-full">
                <LeadTimeline leadId={lead.id} />
              </TabsContent>
              <TabsContent value="intelligence" className="m-0 h-full">
                <div className="flex flex-col items-center justify-center h-full space-y-4 text-center opacity-60">
                    <Brain className="w-12 h-12 text-purple-500 animate-pulse" />
                    <div className="space-y-1">
                        <p className="text-sm font-semibold">Análise de IA em tempo real</p>
                        <p className="text-xs text-muted-foreground max-w-[280px]">O Salomão está analisando o histórico deste lead para sugerir o próximo passo ideal.</p>
                    </div>
                    <Button variant="outline" size="sm" className="border-purple-500/50 text-purple-400">Solicitar Insight</Button>
                </div>
              </TabsContent>
              <TabsContent value="followup" className="m-0 h-full">
                 <div className="text-center p-8 bg-black/40 rounded-xl border border-dashed border-white/10 mt-12">
                    <p className="text-xs text-muted-foreground">Fila de follow-ups agendados aparecerá aqui.</p>
                 </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LeadDetailModal;
