import { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  Plus, Loader2, Trash2, Zap, Mail, Tag,
  Bell, AlertTriangle, UserCheck, UserX, Settings2,
} from 'lucide-react';

interface Automation {
  id: string;
  name: string;
  trigger_event: string;
  action_type: string;
  action_config: Record<string, any>;
  is_active: boolean;
  trigger_count: number;
  created_at: string;
}

const TRIGGER_OPTIONS = [
  { value: 'new_lead', label: 'Novo lead criado no FluxCRM', icon: UserCheck },
  { value: 'lead_interested', label: 'Lead classificado como Interessado', icon: UserCheck },
  { value: 'lead_question', label: 'Lead fez pergunta', icon: UserCheck },
  { value: 'lead_opt_out', label: 'Lead pediu opt-out', icon: UserX },
  { value: 'lead_responded', label: 'Qualquer resposta recebida', icon: Bell },
  { value: 'campaign_completed', label: 'Campanha concluída', icon: Zap },
  { value: 'instance_disconnected', label: 'Instância desconectou', icon: AlertTriangle },
];

const ACTION_OPTIONS = [
  { value: 'send_email', label: 'Enviar e-mail para equipe', icon: Mail },
  { value: 'add_tag', label: 'Adicionar tag ao contato', icon: Tag },
  { value: 'move_to_list', label: 'Mover para lista', icon: Settings2 },
  { value: 'notify_webhook', label: 'Chamar webhook externo', icon: Zap },
];

export default function WhatsAppAutomations({ embedded }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formTrigger, setFormTrigger] = useState('');
  const [formAction, setFormAction] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formTag, setFormTag] = useState('');
  const [formWebhookUrl, setFormWebhookUrl] = useState('');

  const fetchAutomations = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from('wa_automations')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (!error && data) setAutomations(data as unknown as Automation[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchAutomations();
  }, [fetchAutomations]);

  const resetForm = () => {
    setFormName('');
    setFormTrigger('');
    setFormAction('');
    setFormEmail('');
    setFormTag('');
    setFormWebhookUrl('');
  };

  const handleSave = async () => {
    if (!user || !formName.trim() || !formTrigger || !formAction) {
      toast({ title: 'Preencha todos os campos obrigatórios', variant: 'destructive' });
      return;
    }

    const actionConfig: Record<string, any> = {};
    if (formAction === 'send_email') actionConfig.email = formEmail;
    if (formAction === 'add_tag') actionConfig.tag = formTag;
    if (formAction === 'notify_webhook') actionConfig.webhook_url = formWebhookUrl;

    setSaving(true);
    const { error } = await (supabase as any).from('wa_automations').insert({
      user_id: user.id,
      name: formName.trim(),
      trigger_event: formTrigger,
      action_type: formAction,
      action_config: actionConfig,
      is_active: true,
    });

    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Automação criada!' });
      resetForm();
      setDialogOpen(false);
      fetchAutomations();
    }
    setSaving(false);
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    await (supabase as any).from('wa_automations').update({ is_active: !isActive }).eq('id', id);
    fetchAutomations();
  };

  const handleDelete = async (id: string) => {
    await (supabase as any).from('wa_automations').delete().eq('id', id);
    setAutomations(prev => prev.filter(a => a.id !== id));
    toast({ title: 'Automação excluída' });
  };

  const getTriggerLabel = (val: string) => TRIGGER_OPTIONS.find(t => t.value === val)?.label || val;
  const getActionLabel = (val: string) => ACTION_OPTIONS.find(a => a.value === val)?.label || val;

  const Wrapper = embedded ? ({ children }: { children: React.ReactNode }) => <div className="h-full overflow-y-auto">{children}</div> : MainLayout;

  return (
    <Wrapper>
      <div className="space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Zap className="h-6 w-6 text-primary" />
              Automações WhatsApp
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Crie regras automáticas baseadas em eventos de resposta dos leads
            </p>
          </div>
          <Button className="gap-2" onClick={() => { resetForm(); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> Nova Automação
          </Button>
        </div>

        {/* Create Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Nova Automação</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Nome</Label>
                <Input placeholder="Ex: Notificar vendedor" value={formName} onChange={e => setFormName(e.target.value)} />
              </div>
              <div>
                <Label>Quando (Trigger)</Label>
                <Select value={formTrigger} onValueChange={setFormTrigger}>
                  <SelectTrigger><SelectValue placeholder="Selecione o evento" /></SelectTrigger>
                  <SelectContent>
                    {TRIGGER_OPTIONS.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Ação</Label>
                <Select value={formAction} onValueChange={setFormAction}>
                  <SelectTrigger><SelectValue placeholder="Selecione a ação" /></SelectTrigger>
                  <SelectContent>
                    {ACTION_OPTIONS.map(a => (
                      <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {formAction === 'send_email' && (
                <div>
                  <Label>E-mail de destino</Label>
                  <Input type="email" placeholder="vendas@empresa.com" value={formEmail} onChange={e => setFormEmail(e.target.value)} />
                </div>
              )}
              {formAction === 'add_tag' && (
                <div>
                  <Label>Tag</Label>
                  <Input placeholder="Ex: qualificado" value={formTag} onChange={e => setFormTag(e.target.value)} />
                </div>
              )}
              {formAction === 'notify_webhook' && (
                <div>
                  <Label>URL do Webhook</Label>
                  <Input placeholder="https://..." value={formWebhookUrl} onChange={e => setFormWebhookUrl(e.target.value)} />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Criar Automação
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Automations List */}
        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : automations.length === 0 ? (
            <div className="space-y-4">
              {/* Onboarding explanation */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 flex gap-3">
                <span className="text-2xl shrink-0">⚡</span>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">O que são automações?</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Automações executam ações automaticamente quando algo acontece. Por exemplo: quando um lead responder "sim", o sistema pode notificar sua equipe por e-mail ou adicionar uma tag ao contato — sem você precisar fazer nada.
                  </p>
                </div>
              </div>
              {/* Example ideas */}
              <p className="text-sm font-semibold text-foreground">Exemplos de automações populares:</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { emoji: '📧', trigger: 'Lead demonstrou interesse', action: 'Notificar equipe por e-mail', triggerVal: 'lead_interested', actionVal: 'send_email' },
                  { emoji: '🏷️', trigger: 'Lead fez uma pergunta', action: 'Adicionar tag "Qualificado"', triggerVal: 'lead_question', actionVal: 'add_tag' },
                  { emoji: '📋', trigger: 'Campanha concluída', action: 'Mover para lista de follow-up', triggerVal: 'campaign_completed', actionVal: 'move_to_list' },
                ].map(ex => (
                  <button
                    key={ex.emoji}
                    onClick={() => {
                      resetForm();
                      setFormName(`${ex.trigger} → ${ex.action}`);
                      setFormTrigger(ex.triggerVal);
                      setFormAction(ex.actionVal);
                      setDialogOpen(true);
                    }}
                    className="group flex flex-col gap-2 rounded-lg border border-border/40 bg-background/50 p-4 text-left transition-all hover:border-primary/40 hover:bg-primary/5"
                  >
                    <span className="text-2xl">{ex.emoji}</span>
                    <div>
                      <p className="text-xs text-muted-foreground">Quando: <strong className="text-foreground">{ex.trigger}</strong></p>
                      <p className="text-xs text-muted-foreground mt-0.5">Ação: <strong className="text-foreground">{ex.action}</strong></p>
                    </div>
                    <span className="text-xs text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity">Usar este modelo →</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            automations.map(auto => (
              <Card key={auto.id} className={`transition-opacity ${!auto.is_active ? 'opacity-60' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-foreground">{auto.name}</h3>
                        {auto.trigger_count > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {auto.trigger_count}x executada
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className="text-xs gap-1">
                          <Zap className="h-3 w-3" />
                          {getTriggerLabel(auto.trigger_event)}
                        </Badge>
                        <span className="text-muted-foreground text-xs self-center">→</span>
                        <Badge variant="outline" className="text-xs gap-1">
                          {getActionLabel(auto.action_type)}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={auto.is_active}
                        onCheckedChange={() => toggleActive(auto.id, auto.is_active)}
                      />
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(auto.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </Wrapper>
  );
}
