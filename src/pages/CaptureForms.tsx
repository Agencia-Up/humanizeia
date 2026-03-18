import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCaptureForms, useFormSubmissions, CaptureForm } from '@/hooks/useCaptureForms';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Plus, Code, Trash2, Eye, Copy, CheckCircle, XCircle, Clock, Loader2, FileText, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

function FormDialog({ form, onClose, instances }: { form?: CaptureForm; onClose: () => void; instances: any[] }) {
  const { createForm, updateForm } = useCaptureForms();
  const [formData, setFormData] = useState({
    name: form?.name || '',
    description: form?.description || '',
    instance_id: form?.instance_id || '',
    welcome_message: form?.welcome_message || 'Olá {nome}! 👋 Obrigado por se cadastrar!',
    auto_create_contact: form?.auto_create_contact ?? true,
    auto_send_whatsapp: form?.auto_send_whatsapp ?? true,
    auto_add_to_crm: form?.auto_add_to_crm ?? false,
    auto_fire_capi: form?.auto_fire_capi ?? false,
    tags: form?.tags?.join(', ') || '',
    redirect_url: form?.redirect_url || '',
  });

  const handleSave = () => {
    if (!formData.name.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }
    const payload = {
      name: formData.name,
      description: formData.description || null,
      instance_id: formData.instance_id || null,
      welcome_message: formData.welcome_message,
      auto_create_contact: formData.auto_create_contact,
      auto_send_whatsapp: formData.auto_send_whatsapp,
      auto_add_to_crm: formData.auto_add_to_crm,
      auto_fire_capi: formData.auto_fire_capi,
      tags: formData.tags ? formData.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      redirect_url: formData.redirect_url || null,
    };

    if (form) {
      updateForm.mutate({ id: form.id, ...payload } as any, { onSuccess: onClose });
    } else {
      createForm.mutate(payload as any, { onSuccess: onClose });
    }
  };

  return (
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{form ? 'Editar Formulário' : 'Novo Formulário'}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Nome *</Label>
          <Input value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Landing Page Curso X" />
        </div>
        <div className="space-y-1.5">
          <Label>Descrição</Label>
          <Input value={formData.description} onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} placeholder="Opcional" />
        </div>
        <div className="space-y-1.5">
          <Label>Instância WhatsApp</Label>
          <Select value={formData.instance_id} onValueChange={v => setFormData(p => ({ ...p, instance_id: v }))}>
            <SelectTrigger><SelectValue placeholder="Selecione uma instância" /></SelectTrigger>
            <SelectContent>
              {instances.map((inst: any) => (
                <SelectItem key={inst.id} value={inst.id}>{inst.instance_name} ({inst.phone_number || 'sem número'})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Mensagem de Boas-vindas</Label>
          <Textarea
            value={formData.welcome_message}
            onChange={e => setFormData(p => ({ ...p, welcome_message: e.target.value }))}
            placeholder="Use {nome}, {email}, {telefone}"
            rows={4}
          />
          <p className="text-xs text-muted-foreground">Variáveis: {'{nome}'}, {'{email}'}, {'{telefone}'}</p>
        </div>
        <div className="space-y-1.5">
          <Label>Tags (separadas por vírgula)</Label>
          <Input value={formData.tags} onChange={e => setFormData(p => ({ ...p, tags: e.target.value }))} placeholder="lead, produto-x" />
        </div>
        <div className="space-y-1.5">
          <Label>URL de Redirecionamento (após envio)</Label>
          <Input value={formData.redirect_url} onChange={e => setFormData(p => ({ ...p, redirect_url: e.target.value }))} placeholder="https://obrigado.seusite.com" />
        </div>

        <div className="border rounded-lg p-3 space-y-3">
          <p className="text-sm font-medium">Ações Automáticas</p>
          <div className="flex items-center justify-between">
            <Label className="text-sm">Criar contato no WhatsApp</Label>
            <Switch checked={formData.auto_create_contact} onCheckedChange={v => setFormData(p => ({ ...p, auto_create_contact: v }))} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">Enviar mensagem de boas-vindas</Label>
            <Switch checked={formData.auto_send_whatsapp} onCheckedChange={v => setFormData(p => ({ ...p, auto_send_whatsapp: v }))} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">Adicionar ao CRM</Label>
            <Switch checked={formData.auto_add_to_crm} onCheckedChange={v => setFormData(p => ({ ...p, auto_add_to_crm: v }))} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">Disparar evento CAPI (Lead)</Label>
            <Switch checked={formData.auto_fire_capi} onCheckedChange={v => setFormData(p => ({ ...p, auto_fire_capi: v }))} />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button className="gradient-primary" onClick={handleSave} disabled={createForm.isPending || updateForm.isPending}>
          {(createForm.isPending || updateForm.isPending) && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          {form ? 'Salvar' : 'Criar'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function EmbedCodeDialog({ form }: { form: CaptureForm }) {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || 'qrxsiixufdiemwwyhxvd';
  const webhookUrl = `https://${projectId}.supabase.co/functions/v1/capture-form-webhook?form_id=${form.id}`;

  const embedCode = `<!-- HumanizeAI Capture Form - ${form.name} -->
<script>
(function() {
  var FORM_ID = "${form.id}";
  var WEBHOOK_URL = "${webhookUrl}";

  // Capture UTMs from URL
  var params = new URLSearchParams(window.location.search);
  var utmData = {
    utm_source: params.get("utm_source") || "",
    utm_medium: params.get("utm_medium") || "",
    utm_campaign: params.get("utm_campaign") || "",
    utm_content: params.get("utm_content") || "",
    utm_term: params.get("utm_term") || "",
    fbclid: params.get("fbclid") || ""
  };

  window.HumanizeCapture = function(data) {
    var payload = Object.assign({}, utmData, data);
    return fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (res.redirect_url) window.location.href = res.redirect_url;
      return res;
    });
  };
})();
</script>

<!-- Exemplo de uso no formulário -->
<form onsubmit="event.preventDefault(); HumanizeCapture({ name: this.nome.value, phone: this.telefone.value, email: this.email.value }).then(function(r) { if(r.success) alert('Enviado!'); });">
  <input name="nome" placeholder="Seu nome" required />
  <input name="telefone" placeholder="WhatsApp (com DDD)" required />
  <input name="email" placeholder="E-mail" />
  <button type="submit">Enviar</button>
</form>`;

  const handleCopy = () => {
    navigator.clipboard.writeText(embedCode);
    toast.success('Código copiado!');
  };

  return (
    <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Code className="h-5 w-5" />
          Código Embed - {form.name}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Cole este código na sua landing page para capturar leads automaticamente.
        </p>
        <div className="relative">
          <pre className="bg-muted/50 rounded-lg p-4 text-xs overflow-x-auto max-h-96 whitespace-pre-wrap break-all">
            {embedCode}
          </pre>
          <Button size="sm" variant="outline" className="absolute top-2 right-2" onClick={handleCopy}>
            <Copy className="h-3 w-3 mr-1" /> Copiar
          </Button>
        </div>
        <div className="bg-muted/30 rounded-lg p-3 text-xs space-y-1">
          <p className="font-medium">📌 Webhook URL:</p>
          <code className="text-primary break-all">{webhookUrl}</code>
        </div>
      </div>
    </DialogContent>
  );
}

function SubmissionsDialog({ form }: { form: CaptureForm }) {
  const { data: submissions, isLoading } = useFormSubmissions(form.id);

  const statusIcon = (status: string) => {
    switch (status) {
      case 'processed': return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
      case 'partial': return <Clock className="h-3.5 w-3.5 text-yellow-500" />;
      case 'error': return <XCircle className="h-3.5 w-3.5 text-red-500" />;
      default: return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  return (
    <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Submissions - {form.name}</DialogTitle>
      </DialogHeader>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : !submissions?.length ? (
        <p className="text-center text-muted-foreground py-8">Nenhuma submissão ainda.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Data</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {submissions.map(sub => (
              <TableRow key={sub.id}>
                <TableCell>{statusIcon(sub.status)}</TableCell>
                <TableCell className="text-sm">{sub.name || '-'}</TableCell>
                <TableCell className="text-sm">{sub.phone || '-'}</TableCell>
                <TableCell className="text-sm">{sub.email || '-'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{sub.utm_source || '-'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{format(new Date(sub.created_at), 'dd/MM HH:mm')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DialogContent>
  );
}

export default function CaptureForms() {
  const { forms, isLoading, deleteForm, toggleForm } = useCaptureForms();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingForm, setEditingForm] = useState<CaptureForm | undefined>();
  const [codeForm, setCodeForm] = useState<CaptureForm | null>(null);
  const [subsForm, setSubsForm] = useState<CaptureForm | null>(null);

  const { data: instances = [] } = useQuery({
    queryKey: ['wa-instances-for-forms'],
    queryFn: async () => {
      const { data } = await supabase.from('wa_instances').select('id, instance_name, phone_number').eq('is_active', true);
      return data || [];
    },
  });

  const handleNew = () => {
    setEditingForm(undefined);
    setDialogOpen(true);
  };

  const handleEdit = (form: CaptureForm) => {
    setEditingForm(form);
    setDialogOpen(true);
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Formulários de Captura</h1>
            <p className="text-muted-foreground text-sm">Capture leads e envie WhatsApp automaticamente</p>
          </div>
          <Button className="gradient-primary" onClick={handleNew}>
            <Plus className="h-4 w-4 mr-1" /> Novo Formulário
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : forms.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground mb-4">Nenhum formulário criado ainda</p>
              <Button className="gradient-primary" onClick={handleNew}>
                <Plus className="h-4 w-4 mr-1" /> Criar Primeiro Formulário
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {forms.map(form => (
              <Card key={form.id} className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base">{form.name}</CardTitle>
                      {form.description && <CardDescription className="text-xs mt-1">{form.description}</CardDescription>}
                    </div>
                    <Switch
                      checked={form.is_active}
                      onCheckedChange={v => toggleForm.mutate({ id: form.id, is_active: v })}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {form.auto_send_whatsapp && <Badge variant="secondary" className="text-[10px]">📱 WhatsApp</Badge>}
                    {form.auto_create_contact && <Badge variant="secondary" className="text-[10px]">👤 Contato</Badge>}
                    {form.auto_add_to_crm && <Badge variant="secondary" className="text-[10px]">📋 CRM</Badge>}
                    {form.auto_fire_capi && <Badge variant="secondary" className="text-[10px]">📊 CAPI</Badge>}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{form.submission_count} submissões</span>
                    <Badge variant={form.is_active ? 'default' : 'secondary'} className={form.is_active ? 'bg-primary/20 text-primary border-primary/30' : ''}>
                      {form.is_active ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </div>
                  <div className="flex gap-1.5 pt-1">
                    <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => handleEdit(form)}>
                      Editar
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs" onClick={() => setCodeForm(form)}>
                      <Code className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs" onClick={() => setSubsForm(form)}>
                      <Eye className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs text-destructive hover:text-destructive"
                      onClick={() => { if (confirm('Deletar formulário?')) deleteForm.mutate(form.id); }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        {dialogOpen && <FormDialog form={editingForm} onClose={() => setDialogOpen(false)} instances={instances} />}
      </Dialog>

      <Dialog open={!!codeForm} onOpenChange={() => setCodeForm(null)}>
        {codeForm && <EmbedCodeDialog form={codeForm} />}
      </Dialog>

      <Dialog open={!!subsForm} onOpenChange={() => setSubsForm(null)}>
        {subsForm && <SubmissionsDialog form={subsForm} />}
      </Dialog>
    </MainLayout>
  );
}
