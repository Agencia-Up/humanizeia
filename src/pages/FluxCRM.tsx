import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import * as XLSX from 'xlsx';
import {
  AlertCircle,
  Building2,
  FileSpreadsheet,
  GripVertical,
  Kanban,
  Loader2,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useFluxCRM, type CRMLead } from '@/hooks/useFluxCRM';
import { toast } from 'sonner';

type FormState = {
  name: string;
  phone: string;
  email: string;
  company: string;
  value: string;
  source: string;
  notes: string;
  stage_id: string;
  priority: string;
};

type ImportedLead = {
  name: string;
  phone: string;
  email: string;
  company: string;
  notes: string;
  source: string;
  valid: boolean;
};

const EMPTY_FORM: FormState = {
  name: '',
  phone: '',
  email: '',
  company: '',
  value: '',
  source: 'manual',
  notes: '',
  stage_id: '',
  priority: 'medium',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Baixa',
  medium: 'Media',
  high: 'Alta',
  urgent: 'Urgente',
};

const normalizeText = (value: unknown) =>
  String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const normalizePhone = (value: string) => {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return digits.slice(2);
  return digits;
};

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function readField(row: Record<string, unknown>, aliases: string[]) {
  const foundKey = Object.keys(row).find((key) => aliases.includes(normalizeText(key)));
  return foundKey ? String(row[foundKey] ?? '').trim() : '';
}

function leadToForm(lead: CRMLead): FormState {
  return {
    name: lead.name || '',
    phone: lead.phone || '',
    email: lead.email || '',
    company: lead.company || '',
    value: lead.value ? String(lead.value) : '',
    source: lead.source || 'manual',
    notes: lead.notes || '',
    stage_id: lead.stage_id || '',
    priority: lead.priority || 'medium',
  };
}

function formToPayload(form: FormState, position: number): Partial<CRMLead> {
  return {
    name: form.name.trim(),
    phone: normalizePhone(form.phone),
    email: form.email.trim() || null,
    company: form.company.trim() || null,
    value: Number(String(form.value || '0').replace(/\./g, '').replace(',', '.')) || 0,
    source: form.source.trim() || 'manual',
    notes: form.notes.trim() || null,
    stage_id: form.stage_id || null,
    priority: form.priority || 'medium',
    currency: 'BRL',
    tags: ['Marcos Manual'],
    position,
    custom_fields: {
      crm_owner: 'marcos',
      input_mode: 'manual',
    },
  };
}

export default function FluxCRM({ embedded }: { embedded?: boolean } = {}) {
  const { stages, leads, loading, addLead, updateLead, deleteLead, moveLead, getLeadsByStage, totalValue, refetch } = useFluxCRM();
  const fileRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editLead, setEditLead] = useState<CRMLead | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importedLeads, setImportedLeads] = useState<ImportedLead[]>([]);
  const [importing, setImporting] = useState(false);

  const firstStageId = stages[0]?.id || '';
  const filteredLeads = useMemo(() => {
    const term = normalizeText(search);
    if (!term) return leads;
    return leads.filter((lead) =>
      [lead.name, lead.phone, lead.email, lead.company, lead.source, lead.notes]
        .some((field) => normalizeText(field).includes(term))
    );
  }, [leads, search]);

  const leadsByStage = useMemo(() => {
    const map = new Map<string, CRMLead[]>();
    stages.forEach((stage) => map.set(stage.id, []));
    filteredLeads.forEach((lead) => {
      const stageId = lead.stage_id || firstStageId;
      if (!map.has(stageId)) map.set(stageId, []);
      map.get(stageId)?.push(lead);
    });
    map.forEach((items) => items.sort((a, b) => (a.position || 0) - (b.position || 0)));
    return map;
  }, [filteredLeads, firstStageId, stages]);

  const Wrapper = embedded
    ? ({ children }: { children: ReactNode }) => <>{children}</>
    : MainLayout;

  const resetForm = (stageId = firstStageId) => setForm({ ...EMPTY_FORM, stage_id: stageId });

  const openAdd = () => {
    resetForm();
    setAddOpen(true);
  };

  const openEdit = (lead: CRMLead) => {
    setEditLead(lead);
    setForm(leadToForm(lead));
  };

  const handleSave = async () => {
    const name = form.name.trim();
    const phone = normalizePhone(form.phone);
    if (!name || !phone) {
      toast.error('Informe nome e telefone do lead');
      return;
    }

    setSaving(true);
    try {
      if (editLead) {
        updateLead(editLead.id, {
          ...formToPayload(form, editLead.position || 0),
          custom_fields: {
            ...(editLead.custom_fields || {}),
            crm_owner: 'marcos',
            input_mode: 'manual',
          },
        });
        setEditLead(null);
      } else {
        const stageId = form.stage_id || firstStageId;
        const position = getLeadsByStage(stageId).length;
        await addLead(formToPayload({ ...form, stage_id: stageId }, position));
        setAddOpen(false);
      }
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const leadId = result.draggableId;
    const stageId = result.destination.droppableId;
    moveLead(leadId, stageId, result.destination.index);
  };

  const parseFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    let rows: Record<string, unknown>[] = [];

    if (ext === 'xlsx' || ext === 'xls') {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    } else {
      const text = await file.text();
      const workbook = XLSX.read(text, { type: 'string' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    }

    const parsed = rows.map((row) => {
      const name = readField(row, ['nome', 'name', 'cliente', 'lead']);
      const phone = normalizePhone(readField(row, ['telefone', 'whatsapp', 'phone', 'celular', 'numero']));
      return {
        name: name || phone || 'Lead',
        phone,
        email: readField(row, ['email', 'e-mail']),
        company: readField(row, ['empresa', 'company']),
        notes: readField(row, ['observacao', 'observacoes', 'obs', 'notas', 'notes']),
        source: readField(row, ['origem', 'source', 'fonte']) || 'importacao',
        valid: phone.length >= 8,
      };
    });

    setImportedLeads(parsed);
    setImportOpen(true);
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      await parseFile(file);
    } catch (error) {
      console.error(error);
      toast.error('Nao foi possivel ler a planilha');
    }
  };

  const handleImport = async () => {
    const valid = importedLeads.filter((lead) => lead.valid);
    if (valid.length === 0) return;

    setImporting(true);
    try {
      const stageId = firstStageId;
      let position = getLeadsByStage(stageId).length;
      for (const lead of valid) {
        await addLead({
          name: lead.name,
          phone: lead.phone,
          email: lead.email || null,
          company: lead.company || null,
          notes: lead.notes || null,
          source: lead.source || 'importacao',
          stage_id: stageId,
          value: 0,
          currency: 'BRL',
          priority: 'medium',
          tags: ['Marcos Manual', 'Importado'],
          position: position++,
          custom_fields: {
            crm_owner: 'marcos',
            input_mode: 'import',
            imported_at: new Date().toISOString(),
          },
        });
      }
      toast.success(`${valid.length} lead(s) importado(s) no CRM do Marcos`);
      setImportedLeads([]);
      setImportOpen(false);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Wrapper>
      <div className={embedded ? 'h-full min-h-0 flex flex-col bg-background' : 'h-full min-h-0 flex flex-col'}>
        <div className="px-6 py-4 border-b border-border/40 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
                <Kanban className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">CRM Manual do Marcos</h2>
                <p className="text-xs text-muted-foreground">Leads adicionados manualmente, por planilha ou formulario.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="h-7 border-emerald-500/30 text-emerald-300">
                {leads.length} lead(s)
              </Badge>
              <Badge variant="outline" className="h-7 border-amber-500/30 text-amber-300">
                {currency.format(totalValue)}
              </Badge>
              <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={loading} className="h-8 w-8">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2 lg:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nome, telefone, empresa ou origem..."
                className="pl-9"
              />
            </div>
            <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-2 border-amber-500/30 text-amber-300 hover:text-amber-200">
              <FileSpreadsheet className="h-4 w-4" />
              Importar Planilha
            </Button>
            <Button onClick={openAdd} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus className="h-4 w-4" />
              Adicionar Lead
            </Button>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} className="hidden" />
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-xs text-cyan-100">
            <AlertCircle className="h-4 w-4 shrink-0 text-cyan-300 mt-0.5" />
            <span>Este CRM nao usa o agente Pedro. Os leads daqui ficam no funil manual do Marcos e nao entram na esteira automatica de respostas.</span>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="flex-1 min-h-0 overflow-x-auto px-6 py-4">
              <div className="flex gap-4 min-w-max h-full">
                {stages.map((stage) => {
                  const stageLeads = leadsByStage.get(stage.id) || [];
                  return (
                    <Droppable droppableId={stage.id} key={stage.id}>
                      {(provided, snapshot) => (
                        <section
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`w-[320px] min-h-[520px] rounded-lg border bg-card/70 transition-colors ${snapshot.isDraggingOver ? 'border-primary/50 bg-primary/5' : 'border-border/60'}`}
                        >
                          <header className="flex items-center justify-between px-4 py-3 border-b border-border/50" style={{ borderTopColor: stage.color }}>
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                              <h3 className="text-sm font-semibold text-foreground">{stage.name}</h3>
                            </div>
                            <Badge variant="secondary" className="h-6 text-xs">{stageLeads.length}</Badge>
                          </header>
                          <div className="p-3 space-y-3">
                            {stageLeads.length === 0 && (
                              <div className="h-28 rounded-lg border border-dashed border-border/60 flex items-center justify-center text-xs text-muted-foreground">
                                Arraste um lead aqui
                              </div>
                            )}
                            {stageLeads.map((lead, index) => (
                              <Draggable draggableId={lead.id} index={index} key={lead.id}>
                                {(dragProvided, dragSnapshot) => (
                                  <article
                                    ref={dragProvided.innerRef}
                                    {...dragProvided.draggableProps}
                                    className={`rounded-lg border border-border/70 bg-background/80 p-3 shadow-sm transition-shadow ${dragSnapshot.isDragging ? 'shadow-lg ring-1 ring-primary/50' : ''}`}
                                  >
                                    <div className="flex items-start gap-2">
                                      <button
                                        type="button"
                                        {...dragProvided.dragHandleProps}
                                        className="mt-1 text-muted-foreground hover:text-foreground"
                                        aria-label="Mover lead"
                                      >
                                        <GripVertical className="h-4 w-4" />
                                      </button>
                                      <div className="min-w-0 flex-1">
                                        <h4 className="text-sm font-semibold text-foreground truncate">{lead.name}</h4>
                                        {lead.phone && (
                                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                                            <Phone className="h-3 w-3" />
                                            <span>{lead.phone}</span>
                                          </div>
                                        )}
                                        {lead.company && (
                                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                                            <Building2 className="h-3 w-3" />
                                            <span className="truncate">{lead.company}</span>
                                          </div>
                                        )}
                                      </div>
                                      <div className="flex gap-1">
                                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(lead)}>
                                          <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-300" onClick={() => deleteLead(lead.id)}>
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                    </div>
                                    {lead.notes && (
                                      <p className="mt-3 text-xs text-muted-foreground line-clamp-2">{lead.notes}</p>
                                    )}
                                    <div className="mt-3 flex items-center gap-1 flex-wrap">
                                      <Badge variant="outline" className="text-[10px] h-5">{lead.source || 'manual'}</Badge>
                                      <Badge variant="outline" className="text-[10px] h-5">{PRIORITY_LABELS[lead.priority] || lead.priority}</Badge>
                                      {lead.value > 0 && <Badge className="text-[10px] h-5 bg-emerald-500/15 text-emerald-300">{currency.format(lead.value)}</Badge>}
                                    </div>
                                  </article>
                                )}
                              </Draggable>
                            ))}
                            {provided.placeholder}
                          </div>
                        </section>
                      )}
                    </Droppable>
                  );
                })}
              </div>
            </div>
          </DragDropContext>
        )}

        <LeadDialog
          open={addOpen || !!editLead}
          title={editLead ? 'Editar lead' : 'Adicionar lead'}
          form={form}
          setForm={setForm}
          stages={stages}
          saving={saving}
          onClose={() => {
            setAddOpen(false);
            setEditLead(null);
            resetForm();
          }}
          onSave={handleSave}
        />

        <Dialog open={importOpen} onOpenChange={(open) => !importing && setImportOpen(open)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-amber-400" />
                Importar leads para o CRM do Marcos
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-lg border border-border/60 p-3">
                  <div className="text-muted-foreground text-xs">Linhas</div>
                  <div className="text-lg font-semibold">{importedLeads.length}</div>
                </div>
                <div className="rounded-lg border border-emerald-500/30 p-3">
                  <div className="text-muted-foreground text-xs">Validos</div>
                  <div className="text-lg font-semibold text-emerald-300">{importedLeads.filter((lead) => lead.valid).length}</div>
                </div>
                <div className="rounded-lg border border-red-500/30 p-3">
                  <div className="text-muted-foreground text-xs">Invalidos</div>
                  <div className="text-lg font-semibold text-red-300">{importedLeads.filter((lead) => !lead.valid).length}</div>
                </div>
              </div>
              <div className="max-h-80 overflow-y-auto rounded-lg border border-border/60">
                {importedLeads.map((lead, index) => (
                  <div key={`${lead.phone}-${index}`} className="grid grid-cols-[1fr_130px_90px] gap-3 px-3 py-2 text-xs border-b border-border/40 last:border-0">
                    <span className="truncate font-medium">{lead.name}</span>
                    <span className="text-muted-foreground">{lead.phone || 'sem telefone'}</span>
                    <Badge variant={lead.valid ? 'secondary' : 'destructive'} className="justify-center h-5">{lead.valid ? 'valido' : 'invalido'}</Badge>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>Cancelar</Button>
                <Button onClick={handleImport} disabled={importing || importedLeads.every((lead) => !lead.valid)} className="gap-2 bg-amber-600 hover:bg-amber-700 text-white">
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Importar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Wrapper>
  );
}

function LeadDialog({
  open,
  title,
  form,
  setForm,
  stages,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  form: FormState;
  setForm: (form: FormState) => void;
  stages: { id: string; name: string }[];
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nome do lead" />
          </div>
          <div className="space-y-2">
            <Label>Telefone</Label>
            <Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="11999999999" />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="email@exemplo.com" />
          </div>
          <div className="space-y-2">
            <Label>Empresa</Label>
            <Input value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} placeholder="Empresa" />
          </div>
          <div className="space-y-2">
            <Label>Origem</Label>
            <Input value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} placeholder="manual, indicacao, importacao..." />
          </div>
          <div className="space-y-2">
            <Label>Valor</Label>
            <Input value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} placeholder="0,00" />
          </div>
          <div className="space-y-2">
            <Label>Etapa</Label>
            <Select value={form.stage_id} onValueChange={(value) => setForm({ ...form, stage_id: value })}>
              <SelectTrigger><SelectValue placeholder="Selecione a etapa" /></SelectTrigger>
              <SelectContent>
                {stages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Prioridade</Label>
            <Select value={form.priority} onValueChange={(value) => setForm({ ...form, priority: value })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Baixa</SelectItem>
                <SelectItem value="medium">Media</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
                <SelectItem value="urgent">Urgente</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2 space-y-2">
            <Label>Observacoes</Label>
            <Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Observacoes sobre o lead" rows={4} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={onSave} disabled={saving} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
