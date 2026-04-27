import { useState, useMemo, useEffect } from 'react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, DollarSign, Users, TrendingUp, Filter, RefreshCw, CalendarDays } from 'lucide-react';
import { KanbanColumn } from '@/components/crm/KanbanColumn';
import { LeadFormDialog } from '@/components/crm/LeadFormDialog';
import LeadDetailModal from '@/features/orchestrator/components/LeadDetailModal';
import { useFluxCRM, type CRMLead } from '@/hooks/useFluxCRM';
import { Card } from '@/components/ui/card';

/* ─── Períodos de filtro ─────────────────────────────────────────────────── */
type DateFilter = 'today' | '7d' | '30d' | '90d' | 'all';
const DATE_FILTERS: { value: DateFilter; label: string; short: string }[] = [
  { value: 'today', label: 'Hoje',          short: 'Hoje'   },
  { value: '7d',    label: 'Últimos 7 dias', short: '7d'    },
  { value: '30d',   label: 'Últimos 30 dias', short: '30d'  },
  { value: '90d',   label: 'Últimos 90 dias', short: '90d'  },
  { value: 'all',   label: 'Todos os leads',  short: 'Tudo' },
];

function getDateThreshold(filter: DateFilter): Date | null {
  if (filter === 'all') return null;
  const now = new Date();
  if (filter === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  }
  const days = filter === '7d' ? 7 : filter === '30d' ? 30 : 90;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export default function FluxCRM({ embedded }: { embedded?: boolean } = {}) {
  const { stages, leads, loading, addLead, updateLead, deleteLead, moveLead, getLeadsByStage, totalValue } = useFluxCRM();
  const [search, setSearch] = useState('');
  const [deferredSearch, setDeferredSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDeferredSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
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

  // Aplica filtro de período + texto em todos os leads
  const dateThreshold = useMemo(() => getDateThreshold(dateFilter), [dateFilter]);

  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      // Filtro de data
      if (dateThreshold) {
        const createdAt = new Date(l.created_at);
        if (createdAt < dateThreshold) return false;
      }
      // Filtro de texto
      if (deferredSearch) {
        const q = deferredSearch.toLowerCase();
        return (
          l.name.toLowerCase().includes(q) ||
          l.company?.toLowerCase().includes(q) ||
          l.email?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [leads, dateThreshold, deferredSearch]);

  const filteredLeadsByStage = (stageId: string) => {
    const allIds = allIdsForStage.get(stageId) || [stageId];
    return filteredLeads
      .filter((l) => l.stage_id && allIds.includes(l.stage_id))
      .sort((a, b) => a.position - b.position);
  };

  const wonLeads = filteredLeads.filter((l) => l.won_at);
  const wonValue = wonLeads.reduce((s, l) => s + (l.value || 0), 0);

  // Contagem de leads de hoje (para o KPI fixo)
  const todayThreshold = useMemo(() => new Date(
    new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 0, 0, 0, 0
  ), []);
  const todayCount = useMemo(
    () => leads.filter((l) => new Date(l.created_at) >= todayThreshold).length,
    [leads, todayThreshold]
  );

  const currentFilterLabel = DATE_FILTERS.find(f => f.value === dateFilter)?.label || 'Tudo';

  const Wrapper = embedded ? ({ children }: { children: React.ReactNode }) => <>{children}</> : MainLayout;

  return (
    <Wrapper>
      <div className="flex flex-col h-full bg-[#0a0a0b]">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 pb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                <Users className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                Marcos
                <span className="text-xs font-normal bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse inline-block" />
                  CRM & Leads
                </span>
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">Arraste os leads entre colunas conforme avançam no pipeline</p>
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
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">
                {dateFilter === 'all' ? 'Total Leads' : currentFilterLabel}
              </p>
              <p className="text-lg font-bold text-white">
                {filteredLeads.length}
                {dateFilter !== 'all' && (
                  <span className="text-xs text-muted-foreground font-normal ml-1">/ {leads.length}</span>
                )}
              </p>
            </div>
          </Card>
          <Card className="p-3 bg-black/40 border-white/5 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
              <DollarSign className="h-4 w-4 text-purple-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Valor no Período</p>
              <p className="text-lg font-bold text-white">{wonValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
            </div>
          </Card>
          <Card className="p-3 bg-black/40 border-white/5 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-green-500/10 flex items-center justify-center border border-green-500/20">
              <TrendingUp className="h-4 w-4 text-green-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Hoje</p>
              <p className="text-lg font-bold text-white">
                {todayCount}
                <span className="text-xs text-green-500 font-normal ml-1">lead{todayCount !== 1 ? 's' : ''}</span>
              </p>
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

        {/* Search + Date Filter */}
        <div className="px-6 pb-4 flex flex-wrap items-center gap-3">
          {/* Busca */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar leads por nome ou empresa..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-black/40 border-white/10 text-white focus:border-purple-500/50"
            />
          </div>

          {/* Filtros rápidos de período */}
          <div className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            {DATE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setDateFilter(f.value)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                  dateFilter === f.value
                    ? 'bg-purple-600 text-white shadow'
                    : 'text-muted-foreground hover:bg-white/5 hover:text-white'
                }`}
              >
                {f.short}
              </button>
            ))}
          </div>

          {/* Badge de resumo quando filtrado */}
          {dateFilter !== 'all' && (
            <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-xs gap-1 shrink-0">
              {filteredLeads.length} de {leads.length} leads
            </Badge>
          )}
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
    </Wrapper>
  );
}

