import { useState, useMemo } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useFluxCRM, type CRMLead, type PipelineStage } from '@/hooks/useFluxCRM';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Users, Search, Phone, Mail, Download, Filter,
  MessageCircle, ChevronDown, ChevronRight
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ─── Helper ────────────────────────────────────────────────────────────────
function formatPhone(phone: string | null) {
  if (!phone) return '—';
  return phone;
}

function stageColor(color: string) {
  return color || '#6366f1';
}

// ─── Contact Row ────────────────────────────────────────────────────────────
function ContactRow({ lead, stage }: { lead: CRMLead; stage: PipelineStage | undefined }) {
  return (
    <TableRow className="hover:bg-muted/40 transition-colors">
      <TableCell className="font-medium">{lead.name}</TableCell>
      <TableCell className="text-muted-foreground">{lead.phone ? (
        <a href={`https://wa.me/${lead.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-primary hover:underline">
          <MessageCircle className="h-3.5 w-3.5" />{formatPhone(lead.phone)}
        </a>
      ) : '—'}</TableCell>
      <TableCell className="text-muted-foreground">{lead.email || '—'}</TableCell>
      <TableCell>
        {stage ? (
          <Badge
            style={{ backgroundColor: stageColor(stage.color) + '22', color: stageColor(stage.color), borderColor: stageColor(stage.color) + '44' }}
            variant="outline" className="font-medium"
          >
            {stage.name}
          </Badge>
        ) : '—'}
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">{lead.source || '—'}</TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {lead.created_at ? new Date(lead.created_at).toLocaleDateString('pt-BR') : '—'}
      </TableCell>
    </TableRow>
  );
}

// ─── Stage Group ────────────────────────────────────────────────────────────
function StageGroup({ stage, leads }: { stage: PipelineStage; leads: CRMLead[] }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 mb-2 group w-full text-left"
      >
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: stageColor(stage.color) }} />
        <span className="font-semibold text-foreground">{stage.name}</span>
        <Badge variant="secondary" className="text-xs">{leads.length}</Badge>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto" /> : <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />}
      </button>
      {open && leads.length > 0 && (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead>Nome</TableHead>
                <TableHead>WhatsApp</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Etapa</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Criado em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <ContactRow key={lead.id} lead={lead} stage={stage} />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {open && leads.length === 0 && (
        <p className="text-sm text-muted-foreground pl-5">Nenhum contato nessa etapa.</p>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────
export default function CRMContacts() {
  const { stages, leads, loading } = useFluxCRM();
  const [search, setSearch] = useState('');
  const [filterStage, setFilterStage] = useState<string>('all');

  // Deduplicate stages by name (robustly)
  const uniqueStages = useMemo(() => {
    const seen = new Set<string>();
    return stages.filter((s) => {
      const key = s.name.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [stages]);

  const stageMap = useMemo(() =>
    new Map(stages.map((s) => [s.id, s])),
    [stages]
  );

  const filtered = useMemo(() => {
    let result = leads;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.phone?.includes(q) ||
          l.email?.toLowerCase().includes(q) ||
          l.company?.toLowerCase().includes(q)
      );
    }
    // Map to unique stages
    if (filterStage !== 'all') {
      const targetName = uniqueStages.find((s) => s.id === filterStage)?.name.toLowerCase().trim();
      if (targetName) {
        const matchingIds = stages.filter((s) => s.name.toLowerCase().trim() === targetName).map((s) => s.id);
        result = result.filter((l) => l.stage_id && matchingIds.includes(l.stage_id));
      }
    }
    return result;
  }, [leads, search, filterStage, uniqueStages, stages]);

  // Download CSV
  const downloadCSV = () => {
    const headers = ['Nome', 'Telefone', 'Email', 'Empresa', 'Etapa', 'Origem', 'Criado em'];
    const rows = filtered.map((l) => [
      l.name,
      l.phone || '',
      l.email || '',
      l.company || '',
      stageMap.get(l.stage_id || '')?.name || '',
      l.source || '',
      l.created_at ? new Date(l.created_at).toLocaleDateString('pt-BR') : '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contatos-logos-ia.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <MainLayout>
      <div className="flex flex-col h-full p-4 gap-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Users className="h-6 w-6 text-primary" /> Contatos
            </h1>
            <p className="text-sm text-muted-foreground">
              Lista de leads agrupados por etapa do pipeline
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={downloadCSV} className="gap-2">
              <Download className="h-4 w-4" />
              Exportar CSV
            </Button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="p-3 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Users className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-lg font-bold">{leads.length}</p>
            </div>
          </Card>
          {uniqueStages.slice(0, 3).map((s) => {
            const matchingIds = stages.filter((st) => st.name.toLowerCase().trim() === s.name.toLowerCase().trim()).map((st) => st.id);
            const count = leads.filter((l) => l.stage_id && matchingIds.includes(l.stage_id)).length;
            return (
              <Card key={s.id} className="p-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: s.color + '22' }}>
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{s.name}</p>
                  <p className="text-lg font-bold">{count}</p>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, telefone, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filterStage} onValueChange={setFilterStage}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filtrar etapa" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as etapas</SelectItem>
              {uniqueStages.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Contact Groups */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">Carregando...</div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {filterStage === 'all' ? (
              uniqueStages.map((stage) => {
                const matchingIds = stages.filter((s) => s.name.toLowerCase().trim() === stage.name.toLowerCase().trim()).map((s) => s.id);
                const stageLeads = filtered.filter((l) => l.stage_id && matchingIds.includes(l.stage_id));
                return (
                  <StageGroup key={stage.id} stage={stage} leads={stageLeads} />
                );
              })
            ) : (
              <Card className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs">
                      <TableHead>Nome</TableHead>
                      <TableHead>WhatsApp</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Etapa</TableHead>
                      <TableHead>Origem</TableHead>
                      <TableHead>Criado em</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((lead) => (
                      <ContactRow key={lead.id} lead={lead} stage={stageMap.get(lead.stage_id || '')} />
                    ))}
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                          Nenhum contato encontrado.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Card>
            )}
          </div>
        )}
      </div>
    </MainLayout>
  );
}
