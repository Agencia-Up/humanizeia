import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, Loader2, RefreshCw, Save, Send, Settings2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { descricaoErro } from '@/lib/erroAmigavel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

const DEFAULT_TEMPLATE =
  'Oi, {nome}. Aqui e da {empresa}. Recebemos seu cadastro no Facebook sobre {interesse}. Posso te ajudar por aqui?';

type Agent = { id: string; name: string | null; is_active?: boolean | null };
type Instance = {
  id: string;
  friendly_name?: string | null;
  instance_name?: string | null;
  status?: string | null;
  is_active?: boolean | null;
};
type Config = {
  id: string;
  ad_account_id: string | null;
  page_id: string;
  page_name: string | null;
  form_id: string;
  form_name: string;
  agent_id: string | null;
  instance_id: string | null;
  is_active: boolean;
  auto_contact_enabled: boolean;
  initial_message_template: string | null;
  last_sync_at: string | null;
};
type MetaForm = { id: string; name: string; status?: string; leads_count?: number; created_time?: string };
type MetaPage = {
  ad_account_id: string;
  ad_account_name: string | null;
  account_id?: string | null;
  page_id: string;
  page_name: string;
  page_picture?: string | null;
  forms: MetaForm[];
};
type MetaLead = {
  id: string;
  lead_name: string | null;
  phone: string | null;
  email: string | null;
  form_name: string | null;
  campaign_name: string | null;
  status: string | null;
  first_contact_sent_at: string | null;
  last_error: string | null;
  created_at: string | null;
};
type FormSettings = {
  agent_id: string;
  instance_id: string;
  auto_contact_enabled: boolean;
  initial_message_template: string;
};

function formatDate(value?: string | null) {
  if (!value) return '--';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function statusBadge(status?: string | null) {
  const normalized = status || 'received';
  const map: Record<string, string> = {
    contacted: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    crm_created: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    failed: 'bg-red-500/15 text-red-300 border-red-500/30',
    waiting_reply: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    received: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  };
  return (
    <Badge variant="outline" className={map[normalized] || map.received}>
      {normalized === 'contacted'
        ? 'Contato enviado'
        : normalized === 'crm_created'
          ? 'No CRM'
          : normalized === 'failed'
            ? 'Falhou'
            : normalized}
    </Badge>
  );
}

function settingsKey(pageId: string, formId: string) {
  return `${pageId}:${formId}`;
}

export function MetaLeadFormsTab({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [pages, setPages] = useState<MetaPage[]>([]);
  const [leads, setLeads] = useState<MetaLead[]>([]);
  const [settings, setSettings] = useState<Record<string, FormSettings>>({});
  const [loading, setLoading] = useState(true);
  const [metaLoading, setMetaLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const configByForm = useMemo(() => {
    const map = new Map<string, Config>();
    for (const config of configs) map.set(settingsKey(config.page_id, config.form_id), config);
    return map;
  }, [configs]);

  const defaultAgentId = agents[0]?.id || '__none';
  const defaultInstanceId = instances[0]?.id || '__none';

  const loadLocalData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [agentsRes, instancesRes, configsRes, leadsRes] = await Promise.all([
        (supabase as any)
          .from('wa_ai_agents')
          .select('id, name, is_active')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
        (supabase as any)
          .from('wa_instances')
          .select('id, friendly_name, instance_name, status, is_active')
          .eq('user_id', userId)
          .eq('is_active', true)
          .order('updated_at', { ascending: false }),
        (supabase as any)
          .from('meta_lead_form_configs')
          .select('*')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false }),
        (supabase as any)
          .from('meta_form_leads')
          .select('id, lead_name, phone, email, form_name, campaign_name, status, first_contact_sent_at, last_error, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      if (agentsRes.error) throw agentsRes.error;
      if (instancesRes.error) throw instancesRes.error;
      if (configsRes.error) throw configsRes.error;
      if (leadsRes.error) throw leadsRes.error;

      setAgents(agentsRes.data || []);
      setInstances(instancesRes.data || []);
      setConfigs(configsRes.data || []);
      setLeads(leadsRes.data || []);
    } catch (error: any) {
      toast({
        title: 'Nao consegui carregar os formularios',
        description: descricaoErro(error) || 'Tente novamente em alguns instantes.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast, userId]);

  useEffect(() => {
    loadLocalData();
  }, [loadLocalData]);

  useEffect(() => {
    const next: Record<string, FormSettings> = {};
    for (const page of pages) {
      for (const form of page.forms || []) {
        const key = settingsKey(page.page_id, form.id);
        const existing = configByForm.get(key);
        next[key] = {
          agent_id: existing?.agent_id || defaultAgentId,
          instance_id: existing?.instance_id || defaultInstanceId,
          auto_contact_enabled: existing?.auto_contact_enabled || false,
          initial_message_template: existing?.initial_message_template || DEFAULT_TEMPLATE,
        };
      }
    }
    setSettings(next);
  }, [configByForm, defaultAgentId, defaultInstanceId, pages]);

  const loadMetaForms = async () => {
    setMetaLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('meta-leadgen', {
        body: { action: 'list_forms' },
      });
      if (error) throw error;
      setPages(data?.pages || []);
      toast({
        title: 'Formularios carregados',
        description: 'Escolha quais formularios entram no Pedro.',
      });
    } catch (error: any) {
      try {
        const fallbackPages = await loadMetaFormsViaExistingApi();
        setPages(fallbackPages);
        toast({
          title: 'Formularios carregados',
          description: 'Busca feita pela integracao Meta existente. O webhook automatico depende do deploy da funcao meta-leadgen.',
        });
      } catch (fallbackError: any) {
        toast({
          title: 'Erro ao buscar formularios na Meta',
          description: descricaoErro(fallbackError) || error?.message || 'Verifique se a conta Meta esta conectada com leads_retrieval.',
          variant: 'destructive',
        });
      }
    } finally {
      setMetaLoading(false);
    }
  };

  const loadMetaFormsViaExistingApi = async (): Promise<MetaPage[]> => {
    const { data: accounts, error: accountsError } = await (supabase as any)
      .from('ad_accounts')
      .select('id, account_id, account_name')
      .eq('user_id', userId)
      .eq('platform', 'meta')
      .eq('is_active', true);
    if (accountsError) throw accountsError;
    if (!accounts?.length) {
      throw new Error('Nenhuma conta Meta ativa encontrada. Reconecte a Meta nas configuracoes.');
    }

    const nextPages: MetaPage[] = [];
    for (const account of accounts) {
      const pagesRes = await supabase.functions.invoke('meta-api', {
        body: {
          endpoint: 'me/accounts',
          targetAccountId: account.account_id,
          params: {
            fields: 'id,name,category,picture{url}',
            limit: 200,
          },
        },
      });
      if (pagesRes.error) throw pagesRes.error;

      for (const page of pagesRes.data?.data || []) {
        const formsRes = await supabase.functions.invoke('meta-api', {
          body: {
            endpoint: `${page.id}/leadgen_forms`,
            targetAccountId: account.account_id,
            params: {
              fields: 'id,name,status,leads_count,created_time',
              limit: 100,
            },
          },
        });

        nextPages.push({
          ad_account_id: account.id,
          account_id: account.account_id,
          ad_account_name: account.account_name || account.account_id,
          page_id: page.id,
          page_name: page.name,
          page_picture: page.picture?.data?.url || null,
          forms: formsRes.error ? [] : (formsRes.data?.data || []),
        });
      }
    }
    return nextPages;
  };

  const saveForm = async (page: MetaPage, form: MetaForm) => {
    const key = settingsKey(page.page_id, form.id);
    const formSettings = settings[key];
    setSavingKey(key);
    try {
      const { data, error } = await supabase.functions.invoke('meta-leadgen', {
        body: {
          action: 'save_config',
          ad_account_id: page.ad_account_id,
          page_id: page.page_id,
          page_name: page.page_name,
          form_id: form.id,
          form_name: form.name,
          agent_id: formSettings?.agent_id === '__none' ? null : formSettings?.agent_id,
          instance_id: formSettings?.instance_id === '__none' ? null : formSettings?.instance_id,
          auto_contact_enabled: formSettings?.auto_contact_enabled === true,
          initial_message_template: formSettings?.initial_message_template || DEFAULT_TEMPLATE,
          raw_form: form,
        },
      });
      if (error) throw error;
      await loadLocalData();
      toast({
        title: 'Formulario conectado ao Pedro',
        description: data?.subscription?.ok
          ? 'Webhook de Lead Ads assinado com sucesso.'
          : 'Formulario salvo. Confira a assinatura do webhook no app Meta se necessario.',
      });
    } catch (error: any) {
      try {
        const { error: upsertError } = await (supabase as any)
          .from('meta_lead_form_configs')
          .upsert({
            user_id: userId,
            ad_account_id: page.ad_account_id,
            page_id: page.page_id,
            page_name: page.page_name,
            form_id: form.id,
            form_name: form.name,
            agent_id: formSettings?.agent_id === '__none' ? null : formSettings?.agent_id,
            instance_id: formSettings?.instance_id === '__none' ? null : formSettings?.instance_id,
            is_active: true,
            auto_contact_enabled: formSettings?.auto_contact_enabled === true,
            initial_message_template: formSettings?.initial_message_template || DEFAULT_TEMPLATE,
            processing_mode: 'pedro_qualifica',
            raw_form: form,
            last_sync_at: new Date().toISOString(),
          }, { onConflict: 'user_id,form_id' });
        if (upsertError) throw upsertError;
        await loadLocalData();
        toast({
          title: 'Formulario salvo',
          description: 'Configuracao salva. O envio automatico depende do deploy da funcao meta-leadgen no Supabase.',
        });
      } catch (fallbackError: any) {
        toast({
          title: 'Erro ao salvar formulario',
          description: descricaoErro(fallbackError) || error?.message || 'Nao foi possivel salvar a configuracao.',
          variant: 'destructive',
        });
      }
    } finally {
      setSavingKey(null);
    }
  };

  const syncForm = async (config: Config) => {
    setSyncingId(config.id);
    try {
      const { data, error } = await supabase.functions.invoke('meta-leadgen', {
        body: { action: 'sync_form', config_id: config.id, limit: 25 },
      });
      if (error) throw error;
      await loadLocalData();
      toast({
        title: 'Sincronizacao concluida',
        description: `${data?.processed || 0} lead(s) recentes verificados.`,
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao sincronizar formulario',
        description: descricaoErro(error) || 'Nao foi possivel puxar os leads recentes.',
        variant: 'destructive',
      });
    } finally {
      setSyncingId(null);
    }
  };

  const updateSettings = (key: string, patch: Partial<FormSettings>) => {
    setSettings((prev) => ({
      ...prev,
      [key]: {
        agent_id: defaultAgentId,
        instance_id: defaultInstanceId,
        auto_contact_enabled: false,
        initial_message_template: DEFAULT_TEMPLATE,
        ...(prev[key] || {}),
        ...patch,
      },
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-blue-500/30 bg-blue-500/10">
              <FileText className="h-4 w-4 text-blue-300" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Formularios Meta</h2>
              <p className="text-xs text-muted-foreground">
                Leads de Facebook Ads entram no CRM do Pedro para qualificacao e transferencia.
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={loadLocalData} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Atualizar painel
          </Button>
          <Button size="sm" onClick={loadMetaForms} disabled={metaLoading} className="gap-2 bg-blue-600 hover:bg-blue-700">
            {metaLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}
            Buscar na Meta
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardHeader className="pb-2">
            <CardDescription>Formularios ativos</CardDescription>
            <CardTitle className="text-2xl">{configs.filter((item) => item.is_active).length}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardHeader className="pb-2">
            <CardDescription>Leads recebidos</CardDescription>
            <CardTitle className="text-2xl">{leads.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardDescription>Primeiro contato automatico</CardDescription>
            <CardTitle className="text-2xl">{configs.filter((item) => item.auto_contact_enabled).length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conectar formularios ao Pedro</CardTitle>
          <CardDescription>
            Selecione o agente e a instancia que vao receber o lead. O disparo automatico so acontece quando estiver ligado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {pages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
              Clique em <b>Buscar na Meta</b> para listar paginas e formularios disponiveis na conta conectada.
            </div>
          ) : (
            pages.map((page) => (
              <div key={`${page.ad_account_id}-${page.page_id}`} className="rounded-xl border border-border/70 bg-card/60 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{page.page_name}</p>
                    <p className="text-xs text-muted-foreground">{page.ad_account_name || 'Conta Meta'} - {page.forms?.length || 0} formulario(s)</p>
                  </div>
                  <Badge variant="outline">{page.page_id}</Badge>
                </div>

                <div className="space-y-3">
                  {(page.forms || []).map((form) => {
                    const key = settingsKey(page.page_id, form.id);
                    const formSettings = settings[key] || {
                      agent_id: defaultAgentId,
                      instance_id: defaultInstanceId,
                      auto_contact_enabled: false,
                      initial_message_template: DEFAULT_TEMPLATE,
                    };
                    const connected = configByForm.get(key);
                    const isSaving = savingKey === key;
                    return (
                      <div key={form.id} className="rounded-lg border border-border/60 bg-background/50 p-3">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-foreground">{form.name}</p>
                              {connected && (
                                <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
                                  <CheckCircle2 className="mr-1 h-3 w-3" />
                                  Conectado
                                </Badge>
                              )}
                              {form.status && <Badge variant="outline">{form.status}</Badge>}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {form.leads_count ?? 0} lead(s) na Meta - ID {form.id}
                            </p>
                          </div>

                          <div className="grid w-full gap-2 lg:w-[720px] lg:grid-cols-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Agente Pedro</Label>
                              <Select
                                value={formSettings.agent_id}
                                onValueChange={(value) => updateSettings(key, { agent_id: value })}
                              >
                                <SelectTrigger className="h-9">
                                  <SelectValue placeholder="Selecione o agente" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none">Sem agente</SelectItem>
                                  {agents.map((agent) => (
                                    <SelectItem key={agent.id} value={agent.id}>
                                      {agent.name || 'Pedro'}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-1">
                              <Label className="text-xs">WhatsApp de saida</Label>
                              <Select
                                value={formSettings.instance_id}
                                onValueChange={(value) => updateSettings(key, { instance_id: value })}
                              >
                                <SelectTrigger className="h-9">
                                  <SelectValue placeholder="Selecione a instancia" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none">Nao enviar automatico</SelectItem>
                                  {instances.map((instance) => (
                                    <SelectItem key={instance.id} value={instance.id}>
                                      {instance.friendly_name || instance.instance_name || instance.id}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-1 lg:col-span-2">
                              <Label className="text-xs">Mensagem inicial</Label>
                              <Textarea
                                value={formSettings.initial_message_template}
                                onChange={(event) => updateSettings(key, { initial_message_template: event.target.value })}
                                className="min-h-[76px] resize-none text-sm"
                              />
                              <p className="text-[11px] text-muted-foreground">
                                Variaveis: {'{nome}'}, {'{empresa}'}, {'{interesse}'}, {'{campanha}'}, {'{anuncio}'}.
                              </p>
                            </div>

                            <div className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2">
                              <Switch
                                checked={formSettings.auto_contact_enabled}
                                onCheckedChange={(checked) => updateSettings(key, { auto_contact_enabled: checked })}
                              />
                              <div>
                                <p className="text-xs font-medium text-foreground">Enviar primeiro WhatsApp automaticamente</p>
                                <p className="text-[11px] text-muted-foreground">Desligado por padrao para evitar disparos indevidos.</p>
                              </div>
                            </div>

                            <Button
                              onClick={() => saveForm(page, form)}
                              disabled={isSaving}
                              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                            >
                              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                              Salvar formulario
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configurados</CardTitle>
            <CardDescription>Sincronize leads recentes quando quiser testar sem esperar webhook.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {configs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum formulario conectado ainda.</p>
            ) : (
              configs.map((config) => (
                <div key={config.id} className="rounded-lg border border-border/60 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{config.form_name}</p>
                      <p className="text-xs text-muted-foreground">{config.page_name || config.page_id}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">Ultima sync: {formatDate(config.last_sync_at)}</p>
                    </div>
                    {config.auto_contact_enabled ? (
                      <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
                        <Send className="mr-1 h-3 w-3" />
                        Auto
                      </Badge>
                    ) : (
                      <Badge variant="outline">Manual</Badge>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full gap-2"
                    onClick={() => syncForm(config)}
                    disabled={syncingId === config.id}
                  >
                    {syncingId === config.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Sincronizar 25 recentes
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Leads recebidos dos formularios</CardTitle>
            <CardDescription>Registro operacional para conferir CRM, WhatsApp e falhas.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto rounded-lg border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lead</TableHead>
                    <TableHead>Formulario</TableHead>
                    <TableHead>Campanha</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Entrada</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        Nenhum lead de formulario recebido ainda.
                      </TableCell>
                    </TableRow>
                  ) : (
                    leads.map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell>
                          <div className="font-medium text-foreground">{lead.lead_name || lead.phone || 'Sem nome'}</div>
                          <div className="text-xs text-muted-foreground">{lead.phone || lead.email || '--'}</div>
                          {lead.last_error && (
                            <div className="mt-1 flex items-center gap-1 text-xs text-red-300">
                              <AlertCircle className="h-3 w-3" />
                              {lead.last_error}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>{lead.form_name || '--'}</TableCell>
                        <TableCell>{lead.campaign_name || '--'}</TableCell>
                        <TableCell>{statusBadge(lead.status)}</TableCell>
                        <TableCell>{formatDate(lead.created_at)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
