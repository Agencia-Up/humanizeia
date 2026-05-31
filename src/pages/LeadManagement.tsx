import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import {
  Users, UserCheck, TrendingUp, DollarSign, Target,
  Plus, Search, Phone, Mail, MessageCircle, Tag,
  Clock, Filter, X, ChevronRight, Send, CheckCircle,
  StickyNote, Flame, Thermometer, Snowflake, Calendar,
  ArrowRight, BarChart3, Loader2, ExternalLink,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface Lead {
  id: string;
  contact_name: string;
  contact_phone: string;
  contact_email?: string;
  campaign_name?: string;
  campaign_id_meta?: string;
  adset_id_meta?: string;
  source: string;
  channel: string;
  status: string;
  temperature: string;
  sale_value?: number;
  sale_date?: string;
  notes?: string;
  tags?: string[];
  first_contact_at: string;
  last_interaction_at: string;
  created_at: string;
}

interface LeadInteraction {
  id: string;
  lead_id: string;
  interaction_type: string;
  content: string;
  created_at: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const PIPELINE_COLUMNS = [
  { key: 'novo', label: 'Novo', color: 'bg-blue-500', borderColor: 'border-blue-500/40', bgCard: 'bg-blue-500/5', textColor: 'text-blue-400', icon: Plus },
  { key: 'em_atendimento', label: 'Em Atendimento', color: 'bg-yellow-500', borderColor: 'border-yellow-500/40', bgCard: 'bg-yellow-500/5', textColor: 'text-yellow-400', icon: MessageCircle },
  { key: 'qualificado', label: 'Qualificado', color: 'bg-orange-500', borderColor: 'border-orange-500/40', bgCard: 'bg-orange-500/5', textColor: 'text-orange-400', icon: UserCheck },
  { key: 'proposta_enviada', label: 'Proposta Enviada', color: 'bg-purple-500', borderColor: 'border-purple-500/40', bgCard: 'bg-purple-500/5', textColor: 'text-purple-400', icon: Send },
  { key: 'venda_realizada', label: 'Venda Realizada', color: 'bg-emerald-500', borderColor: 'border-emerald-500/40', bgCard: 'bg-emerald-500/5', textColor: 'text-emerald-400', icon: CheckCircle },
  { key: 'perdido', label: 'Perdido', color: 'bg-gray-500', borderColor: 'border-gray-500/40', bgCard: 'bg-gray-500/5', textColor: 'text-gray-400', icon: X },
] as const;

// Qualificação do lead no CRM. 3 níveis. Mantemos os valores internos
// quente/morno/frio para compatibilidade com o banco; só os labels/cores mudaram:
//   frio   = Inativo           (não responde)
//   morno  = Pouco qualificado (parou de responder)
//   quente = Qualificado       (demonstrou real interesse)
const TEMPERATURE_CONFIG: Record<string, { label: string; color: string; icon: typeof Flame; bgColor: string; tip: string }> = {
  quente: { label: 'Qualificado', color: 'text-emerald-400', icon: CheckCircle, bgColor: 'bg-emerald-500/15 border-emerald-500/30', tip: 'Lead que demonstrou real interesse' },
  morno: { label: 'Pouco qualificado', color: 'text-amber-400', icon: Thermometer, bgColor: 'bg-amber-500/15 border-amber-500/30', tip: 'Lead que parou de responder' },
  frio: { label: 'Inativo', color: 'text-red-400', icon: Snowflake, bgColor: 'bg-red-500/15 border-red-500/30', tip: 'Lead que não responde' },
};

const STATUS_OPTIONS = PIPELINE_COLUMNS.map(c => ({ value: c.key, label: c.label }));
// Ordem pior → melhor (Inativo, Pouco qualificado, Qualificado). desc = dica curta sempre
// visível; tip = popup ao passar o mouse.
const TEMP_OPTIONS = [
  { value: 'frio', label: '🔴 Inativo', desc: 'Não responde', tip: 'Lead que não responde' },
  { value: 'morno', label: '🟡 Pouco qualificado', desc: 'Parou de responder', tip: 'Lead que parou de responder' },
  { value: 'quente', label: '🟢 Qualificado', desc: 'Demonstrou interesse', tip: 'Lead que demonstrou real interesse' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeSince(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}min`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}m`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11) {
    return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`;
  }
  return phone;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function LeadManagement() {
  const { user } = useAuth();
  const { toast } = useToast();

  // State
  const [leads, setLeads] = useState<Lead[]>([]);
  const [interactions, setInteractions] = useState<LeadInteraction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterTemp, setFilterTemp] = useState('all');
  const [filterCampaign, setFilterCampaign] = useState('all');

  // New lead form
  const [newLead, setNewLead] = useState({
    contact_name: '',
    contact_phone: '',
    contact_email: '',
    campaign_name: '',
    source: 'manual',
    channel: 'whatsapp',
    status: 'novo',
    temperature: 'morno',
    notes: '',
  });

  // Edit state for detail dialog
  const [editStatus, setEditStatus] = useState('');
  const [editTemp, setEditTemp] = useState('');
  const [editSaleValue, setEditSaleValue] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [newNote, setNewNote] = useState('');

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchLeads = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setLeads((data as Lead[]) || []);
    } catch (err: any) {
      console.error('Error fetching leads:', err);
      toast({
        title: 'Erro ao carregar leads',
        description: err.message || 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const fetchInteractions = useCallback(async (leadId: string) => {
    try {
      const { data, error } = await (supabase as any)
        .from('lead_interactions')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setInteractions((data as LeadInteraction[]) || []);
    } catch (err: any) {
      console.error('Error fetching interactions:', err);
    }
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // ── Computed ───────────────────────────────────────────────────────────────

  const campaigns = useMemo(() => {
    const set = new Set(leads.map(l => l.campaign_name).filter(Boolean));
    return Array.from(set) as string[];
  }, [leads]);

  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!l.contact_name.toLowerCase().includes(q) && !l.contact_phone.includes(q)) return false;
      }
      if (filterStatus !== 'all' && l.status !== filterStatus) return false;
      if (filterTemp !== 'all' && l.temperature !== filterTemp) return false;
      if (filterCampaign !== 'all' && l.campaign_name !== filterCampaign) return false;
      return true;
    });
  }, [leads, searchQuery, filterStatus, filterTemp, filterCampaign]);

  const leadsThisMonth = useMemo(() => {
    const now = new Date();
    return leads.filter(l => {
      const d = new Date(l.created_at);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
  }, [leads]);

  const stats = useMemo(() => {
    const total = leadsThisMonth.length;
    const qualificados = leadsThisMonth.filter(l => ['qualificado', 'proposta_enviada', 'venda_realizada'].includes(l.status)).length;
    const vendas = leadsThisMonth.filter(l => l.status === 'venda_realizada');
    const taxaConversao = total > 0 ? ((vendas.length / total) * 100) : 0;
    const faturamento = vendas.reduce((sum, l) => sum + (l.sale_value || 0), 0);
    const cplq = qualificados > 0 ? (faturamento * 0.15 / qualificados) : 0; // Estimated CPLQ

    return { total, qualificados, taxaConversao, faturamento, cplq };
  }, [leadsThisMonth]);

  const pipelineData = useMemo(() => {
    const map: Record<string, Lead[]> = {};
    PIPELINE_COLUMNS.forEach(c => { map[c.key] = []; });
    filteredLeads.forEach(l => {
      if (map[l.status]) map[l.status].push(l);
    });
    return map;
  }, [filteredLeads]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleCreateLead = async () => {
    if (!newLead.contact_name || !newLead.contact_phone) {
      toast({ title: 'Preencha nome e telefone', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const { error } = await (supabase as any).from('leads').insert({
        ...newLead,
        first_contact_at: now,
        last_interaction_at: now,
        created_at: now,
        user_id: user?.id,
      });
      if (error) throw error;
      toast({ title: 'Lead adicionado com sucesso!' });
      setCreateOpen(false);
      setNewLead({
        contact_name: '', contact_phone: '', contact_email: '',
        campaign_name: '', source: 'manual', channel: 'whatsapp',
        status: 'novo', temperature: 'morno', notes: '',
      });
      fetchLeads();
    } catch (err: any) {
      toast({ title: 'Erro ao criar lead', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateLead = async () => {
    if (!selectedLead) return;
    setIsSaving(true);
    try {
      const updates: any = {
        status: editStatus,
        temperature: editTemp,
        notes: editNotes,
        last_interaction_at: new Date().toISOString(),
      };
      if (editSaleValue) updates.sale_value = parseFloat(editSaleValue);
      if (editStatus === 'venda_realizada' && !selectedLead.sale_date) {
        updates.sale_date = new Date().toISOString();
      }

      const { error } = await (supabase as any)
        .from('leads')
        .update(updates)
        .eq('id', selectedLead.id);

      if (error) throw error;
      toast({ title: 'Lead atualizado!' });
      fetchLeads();
      setDetailOpen(false);
    } catch (err: any) {
      toast({ title: 'Erro ao atualizar', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddNote = async () => {
    if (!selectedLead || !newNote.trim()) return;
    try {
      const { error } = await (supabase as any).from('lead_interactions').insert({
        lead_id: selectedLead.id,
        interaction_type: 'nota',
        content: newNote.trim(),
        created_at: new Date().toISOString(),
      });
      if (error) throw error;
      setNewNote('');
      fetchInteractions(selectedLead.id);
      toast({ title: 'Nota adicionada!' });
    } catch (err: any) {
      toast({ title: 'Erro ao adicionar nota', description: err.message, variant: 'destructive' });
    }
  };

  const handleMoveStatus = async (lead: Lead, newStatus: string) => {
    try {
      const updates: any = {
        status: newStatus,
        last_interaction_at: new Date().toISOString(),
      };
      if (newStatus === 'venda_realizada' && !lead.sale_date) {
        updates.sale_date = new Date().toISOString();
      }
      const { error } = await (supabase as any)
        .from('leads')
        .update(updates)
        .eq('id', lead.id);

      if (error) throw error;
      fetchLeads();
      toast({ title: `Lead movido para "${STATUS_OPTIONS.find(s => s.value === newStatus)?.label}"` });
    } catch (err: any) {
      toast({ title: 'Erro ao mover lead', description: err.message, variant: 'destructive' });
    }
  };

  const openDetail = (lead: Lead) => {
    setSelectedLead(lead);
    setEditStatus(lead.status);
    setEditTemp(lead.temperature);
    setEditSaleValue(lead.sale_value?.toString() || '');
    setEditNotes(lead.notes || '');
    setNewNote('');
    fetchInteractions(lead.id);
    setDetailOpen(true);
  };

  const handleWhatsApp = (phone: string) => {
    const cleaned = phone.replace(/\D/g, '');
    const intl = cleaned.startsWith('55') ? cleaned : `55${cleaned}`;
    window.open(`https://wa.me/${intl}`, '_blank');
  };

  const handleMarkSale = async () => {
    if (!selectedLead) return;
    setEditStatus('venda_realizada');
    try {
      const { error } = await (supabase as any)
        .from('leads')
        .update({
          status: 'venda_realizada',
          sale_date: new Date().toISOString(),
          sale_value: editSaleValue ? parseFloat(editSaleValue) : null,
          last_interaction_at: new Date().toISOString(),
        })
        .eq('id', selectedLead.id);

      if (error) throw error;
      toast({ title: 'Venda registrada!' });
      fetchLeads();
      setDetailOpen(false);
    } catch (err: any) {
      toast({ title: 'Erro ao registrar venda', description: err.message, variant: 'destructive' });
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Target className="h-7 w-7 text-amber-400" />
              Gestao de Leads
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Mini-CRM para gerenciar seus leads e acompanhar o funil de vendas
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="bg-amber-500 hover:bg-amber-600 text-black font-semibold gap-2">
            <Plus className="h-4 w-4" />
            Adicionar Lead
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard
            title="Leads (mes)"
            value={stats.total.toString()}
            icon={<Users className="h-5 w-5 text-blue-400" />}
            accent="blue"
          />
          <StatCard
            title="Qualificados"
            value={stats.qualificados.toString()}
            icon={<UserCheck className="h-5 w-5 text-orange-400" />}
            accent="orange"
          />
          <StatCard
            title="Taxa Conversao"
            value={`${stats.taxaConversao.toFixed(1)}%`}
            icon={<TrendingUp className="h-5 w-5 text-emerald-400" />}
            accent="emerald"
          />
          <StatCard
            title="CPLQ"
            value={formatCurrency(stats.cplq)}
            icon={<BarChart3 className="h-5 w-5 text-purple-400" />}
            accent="purple"
          />
          <StatCard
            title="Faturamento"
            value={formatCurrency(stats.faturamento)}
            icon={<DollarSign className="h-5 w-5 text-amber-400" />}
            accent="amber"
          />
        </div>

        {/* Filter Bar */}
        <Card className="bg-card/60 border-border/40">
          <CardContent className="p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome ou telefone..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-9 bg-background/60 border-border/50"
                />
              </div>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[160px] bg-background/60 border-border/50">
                  <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos Status</SelectItem>
                  {STATUS_OPTIONS.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterTemp} onValueChange={setFilterTemp}>
                <SelectTrigger className="w-[150px] bg-background/60 border-border/50">
                  <Thermometer className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue placeholder="Qualificação" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {TEMP_OPTIONS.map(t => (
                    <SelectItem key={t.value} value={t.value} title={t.tip}>
                      <span className="flex flex-col">
                        <span>{t.label}</span>
                        <span className="text-[10px] text-muted-foreground">{t.desc}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {campaigns.length > 0 && (
                <Select value={filterCampaign} onValueChange={setFilterCampaign}>
                  <SelectTrigger className="w-[180px] bg-background/60 border-border/50">
                    <Tag className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                    <SelectValue placeholder="Campanha" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas Campanhas</SelectItem>
                    {campaigns.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {(searchQuery || filterStatus !== 'all' || filterTemp !== 'all' || filterCampaign !== 'all') && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setSearchQuery(''); setFilterStatus('all'); setFilterTemp('all'); setFilterCampaign('all'); }}
                  className="text-muted-foreground hover:text-foreground gap-1"
                >
                  <X className="h-3.5 w-3.5" /> Limpar
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Pipeline / Kanban */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
            <span className="ml-3 text-muted-foreground">Carregando leads...</span>
          </div>
        ) : (
          <div className="overflow-x-auto pb-4">
            <div className="flex gap-3 min-w-[1100px]">
              {PIPELINE_COLUMNS.map(col => {
                const colLeads = pipelineData[col.key] || [];
                const ColIcon = col.icon;
                return (
                  <div key={col.key} className="flex-1 min-w-[180px]">
                    {/* Column header */}
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-t-lg border-b-2 ${col.borderColor} bg-card/80`}>
                      <div className={`h-2.5 w-2.5 rounded-full ${col.color}`} />
                      <span className="text-sm font-semibold text-foreground">{col.label}</span>
                      <Badge variant="secondary" className="ml-auto text-xs px-1.5 py-0">
                        {colLeads.length}
                      </Badge>
                    </div>

                    {/* Column body */}
                    <ScrollArea className="h-[500px]">
                      <div className="space-y-2 p-2 bg-muted/20 rounded-b-lg border border-t-0 border-border/30 min-h-[500px]">
                        {colLeads.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground/50">
                            <ColIcon className="h-8 w-8 mb-2" />
                            <span className="text-xs">Nenhum lead</span>
                          </div>
                        ) : (
                          colLeads.map(lead => (
                            <LeadCard
                              key={lead.id}
                              lead={lead}
                              onClick={() => openDetail(lead)}
                              onWhatsApp={() => handleWhatsApp(lead.contact_phone)}
                              onMoveNext={() => {
                                const idx = PIPELINE_COLUMNS.findIndex(c => c.key === lead.status);
                                if (idx < PIPELINE_COLUMNS.length - 2) {
                                  handleMoveStatus(lead, PIPELINE_COLUMNS[idx + 1].key);
                                }
                              }}
                            />
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Create Lead Dialog ──────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md bg-card border-border/60">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-amber-400" />
              Adicionar Novo Lead
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nome do Contato *</Label>
              <Input
                placeholder="Nome completo"
                value={newLead.contact_name}
                onChange={e => setNewLead({ ...newLead, contact_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Telefone *</Label>
              <Input
                placeholder="(11) 99999-9999"
                value={newLead.contact_phone}
                onChange={e => setNewLead({ ...newLead, contact_phone: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                placeholder="email@exemplo.com"
                type="email"
                value={newLead.contact_email}
                onChange={e => setNewLead({ ...newLead, contact_email: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Canal</Label>
                <Select value={newLead.channel} onValueChange={v => setNewLead({ ...newLead, channel: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="facebook">Facebook</SelectItem>
                    <SelectItem value="site">Site</SelectItem>
                    <SelectItem value="indicacao">Indicacao</SelectItem>
                    <SelectItem value="outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Qualificação</Label>
                <Select value={newLead.temperature} onValueChange={v => setNewLead({ ...newLead, temperature: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TEMP_OPTIONS.map(t => (
                      <SelectItem key={t.value} value={t.value} title={t.tip}>
                      <span className="flex flex-col">
                        <span>{t.label}</span>
                        <span className="text-[10px] text-muted-foreground">{t.desc}</span>
                      </span>
                    </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Campanha (opcional)</Label>
              <Input
                placeholder="Nome da campanha"
                value={newLead.campaign_name}
                onChange={e => setNewLead({ ...newLead, campaign_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Observacoes</Label>
              <Textarea
                placeholder="Notas iniciais sobre o lead..."
                value={newLead.notes}
                onChange={e => setNewLead({ ...newLead, notes: e.target.value })}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleCreateLead}
              disabled={isSaving}
              className="bg-amber-500 hover:bg-amber-600 text-black font-semibold gap-2"
            >
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Adicionar Lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Lead Detail Dialog ─────────────────────────────────────────────── */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl bg-card border-border/60 max-h-[90vh] overflow-y-auto">
          {selectedLead && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-600 to-amber-500 flex items-center justify-center text-white font-bold text-lg">
                    {selectedLead.contact_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-lg">{selectedLead.contact_name}</div>
                    <div className="text-xs text-muted-foreground font-normal flex items-center gap-2">
                      <Clock className="h-3 w-3" />
                      Primeiro contato: {new Date(selectedLead.first_contact_at).toLocaleDateString('pt-BR')}
                    </div>
                  </div>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-5 py-2">
                {/* Contact info */}
                <div className="flex flex-wrap gap-3">
                  <Badge variant="outline" className="gap-1.5 px-3 py-1.5">
                    <Phone className="h-3.5 w-3.5" />
                    {formatPhone(selectedLead.contact_phone)}
                  </Badge>
                  {selectedLead.contact_email && (
                    <Badge variant="outline" className="gap-1.5 px-3 py-1.5">
                      <Mail className="h-3.5 w-3.5" />
                      {selectedLead.contact_email}
                    </Badge>
                  )}
                  {selectedLead.campaign_name && (
                    <Badge variant="outline" className="gap-1.5 px-3 py-1.5">
                      <Tag className="h-3.5 w-3.5" />
                      {selectedLead.campaign_name}
                    </Badge>
                  )}
                </div>

                {/* Quick Actions */}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 border-green-500/40 text-green-400 hover:bg-green-500/10"
                    onClick={() => handleWhatsApp(selectedLead.contact_phone)}
                  >
                    <MessageCircle className="h-4 w-4" />
                    Enviar WhatsApp
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                    onClick={handleMarkSale}
                  >
                    <CheckCircle className="h-4 w-4" />
                    Marcar como Venda
                  </Button>
                </div>

                {/* Edit fields */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <Select value={editStatus} onValueChange={setEditStatus}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map(s => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Qualificação</Label>
                    <Select value={editTemp} onValueChange={setEditTemp}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TEMP_OPTIONS.map(t => (
                          <SelectItem key={t.value} value={t.value} title={t.tip}>
                      <span className="flex flex-col">
                        <span>{t.label}</span>
                        <span className="text-[10px] text-muted-foreground">{t.desc}</span>
                      </span>
                    </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Valor da Venda (R$)</Label>
                  <Input
                    type="number"
                    placeholder="0,00"
                    value={editSaleValue}
                    onChange={e => setEditSaleValue(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Observacoes</Label>
                  <Textarea
                    value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
                    rows={3}
                    placeholder="Notas sobre o lead..."
                  />
                </div>

                {/* Interaction timeline */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <StickyNote className="h-4 w-4 text-amber-400" />
                    <Label className="text-sm font-semibold">Historico de Interacoes</Label>
                  </div>

                  {/* Add note */}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Adicionar uma nota..."
                      value={newNote}
                      onChange={e => setNewNote(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddNote()}
                      className="flex-1"
                    />
                    <Button size="sm" onClick={handleAddNote} variant="outline" className="gap-1">
                      <Plus className="h-3.5 w-3.5" />
                      Nota
                    </Button>
                  </div>

                  {/* Timeline */}
                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {interactions.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">
                        Nenhuma interacao registrada ainda.
                      </p>
                    ) : (
                      interactions.map(inter => (
                        <div
                          key={inter.id}
                          className="flex gap-3 p-2.5 rounded-lg bg-muted/30 border border-border/30"
                        >
                          <div className="h-7 w-7 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                            {inter.interaction_type === 'nota' && <StickyNote className="h-3.5 w-3.5 text-blue-400" />}
                            {inter.interaction_type === 'whatsapp' && <MessageCircle className="h-3.5 w-3.5 text-green-400" />}
                            {inter.interaction_type === 'ligacao' && <Phone className="h-3.5 w-3.5 text-amber-400" />}
                            {!['nota', 'whatsapp', 'ligacao'].includes(inter.interaction_type) && <Clock className="h-3.5 w-3.5 text-gray-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-foreground">{inter.content}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {new Date(inter.created_at).toLocaleString('pt-BR')}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => setDetailOpen(false)}>Fechar</Button>
                <Button
                  onClick={handleUpdateLead}
                  disabled={isSaving}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold gap-2"
                >
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Salvar Alteracoes
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ title, value, icon, accent }: {
  title: string;
  value: string;
  icon: React.ReactNode;
  accent: string;
}) {
  const borderMap: Record<string, string> = {
    blue: 'border-blue-500/30',
    orange: 'border-orange-500/30',
    emerald: 'border-emerald-500/30',
    purple: 'border-purple-500/30',
    amber: 'border-amber-500/30',
  };
  const bgMap: Record<string, string> = {
    blue: 'bg-blue-500/5',
    orange: 'bg-orange-500/5',
    emerald: 'bg-emerald-500/5',
    purple: 'bg-purple-500/5',
    amber: 'bg-amber-500/5',
  };

  return (
    <Card className={`${bgMap[accent] || ''} ${borderMap[accent] || ''} border`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          {icon}
        </div>
        <p className="text-xl font-bold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{title}</p>
      </CardContent>
    </Card>
  );
}

function LeadCard({ lead, onClick, onWhatsApp, onMoveNext }: {
  lead: Lead;
  onClick: () => void;
  onWhatsApp: () => void;
  onMoveNext: () => void;
}) {
  const tempConfig = TEMPERATURE_CONFIG[lead.temperature] || TEMPERATURE_CONFIG.morno;
  const TempIcon = tempConfig.icon;

  return (
    <Card
      className="bg-card/90 border-border/40 hover:border-amber-500/30 transition-all cursor-pointer group"
      onClick={onClick}
    >
      <CardContent className="p-3 space-y-2">
        {/* Name + temp */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground truncate">{lead.contact_name}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <Phone className="h-3 w-3" />
              {formatPhone(lead.contact_phone)}
            </p>
          </div>
          <Badge variant="outline" title={tempConfig.tip} className={`text-[10px] px-1.5 py-0.5 gap-1 flex-shrink-0 ${tempConfig.bgColor}`}>
            <TempIcon className={`h-3 w-3 ${tempConfig.color}`} />
            {tempConfig.label}
          </Badge>
        </div>

        {/* Campaign */}
        {lead.campaign_name && (
          <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
            <Tag className="h-3 w-3 flex-shrink-0" />
            {lead.campaign_name}
          </p>
        )}

        {/* Bottom row: time + value + actions */}
        <div className="flex items-center justify-between pt-1 border-t border-border/30">
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {timeSince(lead.first_contact_at)}
          </span>
          {lead.sale_value && (
            <span className="text-[11px] font-semibold text-emerald-400">
              {formatCurrency(lead.sale_value)}
            </span>
          )}
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={e => { e.stopPropagation(); onWhatsApp(); }}
              className="h-6 w-6 rounded flex items-center justify-center hover:bg-green-500/20 text-green-400"
              title="WhatsApp"
            >
              <MessageCircle className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={e => { e.stopPropagation(); onMoveNext(); }}
              className="h-6 w-6 rounded flex items-center justify-center hover:bg-blue-500/20 text-blue-400"
              title="Avancar etapa"
            >
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
