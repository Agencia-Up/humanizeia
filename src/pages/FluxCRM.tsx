import { useState } from 'react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search, DollarSign, Users, TrendingUp, Filter, ChevronDown, Layers } from 'lucide-react';
import { KanbanColumn } from '@/components/crm/KanbanColumn';
import { LeadFormDialog } from '@/components/crm/LeadFormDialog';
import { useFluxCRM, type CRMLead } from '@/hooks/useFluxCRM';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

export default function FluxCRM() {
  const {
    pipelines, activePipelineId, setActivePipelineId,
    stages, leads, loading,
    addPipeline, deletePipeline,
    addLead, updateLead, deleteLead, moveLead,
    getLeadsByStage, totalValue,
  } = useFluxCRM();

  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<CRMLead | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>('');
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState('');

  const activePipeline = pipelines.find((p) => p.id === activePipelineId);

  const handleDragEnd = (result: DropResult) => {
    const { draggableId, destination } = result;
    if (!destination) return;
    moveLead(draggableId, destination.droppableId, destination.index);
  };

  const openNewLead = (stageId?: string) => {
    setSelectedLead(null);
    setDefaultStageId(stageId || stages[0]?.id || '');
    setDialogOpen(true);
  };

  const openEditLead = (lead: CRMLead) => {
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

  const handleCreatePipeline = () => {
    if (!newPipelineName.trim()) return;
    addPipeline({ name: newPipelineName.trim() });
    setNewPipelineName('');
    setNewPipelineOpen(false);
  };

  const filteredLeadsByStage = (stageId: string) => {
    const stageLeads = getLeadsByStage(stageId);
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
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 pb-2">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-foreground">Flux CRM</h1>
                {/* Pipeline selector */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5 ml-2">
                      <Layers className="h-3.5 w-3.5" />
                      {activePipeline?.name || 'Pipeline'}
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {pipelines.map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        onClick={() => setActivePipelineId(p.id)}
                        className={p.id === activePipelineId ? 'bg-accent' : ''}
                      >
                        <div className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: p.color }} />
                        {p.name}
                        {p.is_default && <span className="text-xs text-muted-foreground ml-2">(padrão)</span>}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setNewPipelineOpen(true)}>
                      <Plus className="h-3.5 w-3.5 mr-2" /> Novo Pipeline
                    </DropdownMenuItem>
                    {activePipeline && !activePipeline.is_default && (
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => deletePipeline(activePipeline.id)}
                      >
                        Excluir Pipeline
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <p className="text-sm text-muted-foreground">Pipeline de vendas e gestão de leads</p>
            </div>
          </div>
          <Button onClick={() => openNewLead()} className="gap-2">
            <Plus className="h-4 w-4" /> Novo Lead
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 pb-3">
          <Card className="p-3 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Users className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Leads</p>
              <p className="text-lg font-bold text-foreground">{leads.length}</p>
            </div>
          </Card>
          <Card className="p-3 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pipeline</p>
              <p className="text-lg font-bold text-foreground">{totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
            </div>
          </Card>
          <Card className="p-3 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-success/10 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-success" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Ganhos</p>
              <p className="text-lg font-bold text-foreground">{wonValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
            </div>
          </Card>
          <Card className="p-3 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-accent/10 flex items-center justify-center">
              <Filter className="h-4 w-4 text-accent" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Etapas</p>
              <p className="text-lg font-bold text-foreground">{stages.length}</p>
            </div>
          </Card>
        </div>

        {/* Search */}
        <div className="px-4 pb-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar leads..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Kanban Board */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">Carregando...</div>
        ) : (
          <div className="flex-1 overflow-x-auto px-4 pb-4">
            <DragDropContext onDragEnd={handleDragEnd}>
              <div className="flex gap-4 h-full min-h-0">
                {stages.map((stage) => (
                  <KanbanColumn
                    key={stage.id}
                    stage={stage}
                    leads={filteredLeadsByStage(stage.id)}
                    onAddLead={openNewLead}
                    onClickLead={openEditLead}
                  />
                ))}
              </div>
            </DragDropContext>
          </div>
        )}
      </div>

      <LeadFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        onDelete={deleteLead}
        lead={selectedLead}
        stages={stages}
        defaultStageId={defaultStageId}
      />

      {/* New Pipeline Dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Pipeline</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Nome do Pipeline</Label>
              <Input
                value={newPipelineName}
                onChange={(e) => setNewPipelineName(e.target.value)}
                placeholder="Ex: Pipeline de Vendas B2B"
                onKeyDown={(e) => e.key === 'Enter' && handleCreatePipeline()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewPipelineOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreatePipeline} disabled={!newPipelineName.trim()}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
