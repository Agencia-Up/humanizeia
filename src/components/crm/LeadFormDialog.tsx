import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CRMLead, PipelineStage } from '@/hooks/useFluxCRM';

interface LeadFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: Partial<CRMLead>) => void;
  onDelete?: (id: string) => void;
  lead?: CRMLead | null;
  stages: PipelineStage[];
  defaultStageId?: string;
}

export function LeadFormDialog({ open, onClose, onSave, onDelete, lead, stages, defaultStageId }: LeadFormDialogProps) {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', company: '', value: 0,
    source: '', notes: '', priority: 'medium', stage_id: defaultStageId || '',
    tags: '',
  });

  useEffect(() => {
    if (lead) {
      setForm({
        name: lead.name || '', email: lead.email || '', phone: lead.phone || '',
        company: lead.company || '', value: lead.value || 0, source: lead.source || '',
        notes: lead.notes || '', priority: lead.priority || 'medium',
        stage_id: lead.stage_id || '', tags: (lead.tags || []).join(', '),
      });
    } else {
      setForm({ name: '', email: '', phone: '', company: '', value: 0, source: '', notes: '', priority: 'medium', stage_id: defaultStageId || '', tags: '' });
    }
  }, [lead, defaultStageId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...lead,
      name: form.name,
      email: form.email || null,
      phone: form.phone || null,
      company: form.company || null,
      value: Number(form.value) || 0,
      source: form.source || null,
      notes: form.notes || null,
      priority: form.priority,
      stage_id: form.stage_id || null,
      tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{lead ? 'Editar Lead' : 'Novo Lead'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Nome *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <Label>Empresa</Label>
              <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            </div>
            <div>
              <Label>Valor (R$)</Label>
              <Input type="number" step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Etapa</Label>
              <Select value={form.stage_id} onValueChange={(v) => setForm({ ...form, stage_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Prioridade</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baixa</SelectItem>
                  <SelectItem value="medium">Média</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fonte</Label>
              <Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Ex: WhatsApp, Site, Indicação" />
            </div>
            <div>
              <Label>Tags (separadas por vírgula)</Label>
              <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="vip, urgente" />
            </div>
            <div className="col-span-2">
              <Label>Notas</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
            </div>
          </div>
          <div className="flex justify-between pt-2">
            {lead && onDelete ? (
              <Button type="button" variant="destructive" size="sm" onClick={() => { onDelete(lead.id); onClose(); }}>
                Excluir
              </Button>
            ) : <div />}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="submit">Salvar</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
