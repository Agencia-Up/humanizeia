import { useState, useMemo } from 'react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search, DollarSign, Users, TrendingUp, Filter, Sparkles, RefreshCw } from 'lucide-react';
import { KanbanColumn } from '@/components/crm/KanbanColumn';
import { LeadFormDialog } from '@/components/crm/LeadFormDialog';
import LeadDetailModal from '@/features/orchestrator/components/LeadDetailModal';
import { useFluxCRM, type CRMLead } from '@/hooks/useFluxCRM';
import { Card } from '@/components/ui/card';

export default function FluxCRM() {
  const { stages, leads, loading, addLead, updateLead, deleteLead, moveLead, getLeadsByStage, totalValue } = useFluxCRM();
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<CRMLead | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>('');

  // ... (useMemo code remains same, keeping concise)
  const uniqueStages = useMemo(() => {
    const seen = new Set<string>();
    return stages.filter((s) => {
      const key = s.name.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [stages]);

  const allIdsForStage = useMemo(() => {
    const map = new Map<string, string[]>();
    uniqueStages.forEach((us) => {
      const key = us.name.toLowerCase().trim();
      const all = stages.filter((s) => s.name.toLowerCase().trim() === key).map((s) => s.id);
      map.set(us.id, all);
    });
    return map;
  }, [uniqueStages, stages]);

  const handleDragEnd = (result: DropResult) => {
    const { draggableId, destination } = result;
    if (!destination) return;
    moveLead(draggableId, destination.droppableId, destination.index);
  };

  const openNewLead = (stageId?: string) => {
    setSelectedLead(null);
    setDefaultStageId(stageId || uniqueStages[0]?.id || '');
    setDialogOpen(true);
  };

  const openLeadDetail = (lead: CRMLead) => {
    setSelectedLead(lead);
    setDetailOpen(true);
  };

  const openEditLead = (lead: CRMLead) => {
    setDetailOpen(false);
    setSelectedLead(lead);
    setDefaultStageId(lead.stage_id || '');
    setDialogOpen(true);
  };

  const handleSave = (data: Partial<CRMLead>) => {
    if (selectedLead) {
      updateLead(selectedLead.id, data);
    } else {
      addLead(data);
    }
  };

  const filteredLeadsByStage = (stageId: string) => {
    const allIds = allIdsForStage.get(stageId) || [stageId];
    const stageLeads = leads
      .filter((l) => l.stage_id && allIds.includes(l.stage_id))
      .sort((a, b) => a.position - b.position);
    if (!search) return stageLeads;
    const q = search.toLowerCase();
    return stageLeads.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.company?.toLowerCase().includes(q) ||
        l.email?.toLowerCase().includes(q)
    );
  };

  const wonLeads = leads.filter((l) => l.won_at);
  const wonValue = wonLeads.reduce((s, l) => s + (l.value || 0), 0);

  return (
    <MainLayout>
      <div className="flex flex-col h-full bg-[#0a0a0b]">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 pb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                <Sparkles className="h-6 w-6 text-purple-500" />
            </div>
            <div>
                <h1 className="text-2xl font-bold text-white">CRM — Pipeline de Vendas</h1>
                <p className="text-xs text-muted-foreground">Arraste os leads entre colunas conforme avançam no processo</p>
            </div>
          </div>
          <Button onClick={() => openNewLead()} className="bg-purple-600 hover:bg-purple-700 text-white gap-2">
            <Plus className="h-4 w-4" /> Novo Lead
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-6 pb-3 mt-4">
          <Card className="p-3 bg-black/40 border-white/5 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
              <Users className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Total Leads</p>
              <p className="text-lg font-bold text-white">{leads.length}</p>
            </div>
          </Card>
          <Card className="p-3 bg-black/40 border-white/5 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
              <DollarSign className="h-4 w-4 text-purple-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Fluxo de Etapas</p>
              <p className="text-lg font-bold text-white">{totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
            </div>
          </Card>
          <Card className="p-3 bg-black/40 border-white/5 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-green-500/10 flex items-center justify-center border border-green-500/20">
              <TrendingUp className="h-4 w-4 text-green-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Ganhos</p>
              <p className="text-lg font-bold text-white">{wonValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
            </div>
          </Card>
          <Card className="p-3 bg-black/40 border-white/5 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
              <Filter className="h-4 w-4 text-orange-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Etapas</p>
              <p className="text-lg font-bold text-white">{uniqueStages.length}</p>
            </div>
          </Card>
        </div>

        {/* Search */}
        <div className="px-6 pb-6">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar leads por nome ou empresa..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-black/40 border-white/10 text-white focus:border-purple-500/50"
            />
          </div>
        </div>

        {/* Kanban Board */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <RefreshCw className="h-8 w-8 animate-spin text-purple-500 mb-4" />
          </div>
        ) : (
          <div className="flex-1 overflow-x-auto px-6 pb-6">
            <DragDropContext onDragEnd={handleDragEnd}>
              <div className="flex gap-4 h-full min-h-0">
                {uniqueStages.map((stage) => (
                  <KanbanColumn
                    key={stage.id}
                    stage={stage}
                    leads={filteredLeadsByStage(stage.id)}
                    onAddLead={openNewLead}
                    onClickLead={openLeadDetail}
                  />
                ))}
              </div>
            </DragDropContext>
          </div>
        )}
      </div>

      <LeadDetailModal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        lead={selectedLead}
        stages={stages}
        onEdit={openEditLead}
      />

      <LeadFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        onDelete={deleteLead}
        lead={selectedLead}
        stages={stages}
        defaultStageId={defaultStageId}
      />
    </MainLayout>
  );
}

