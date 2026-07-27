import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Bot, Cable, CircleOff, Clock3, FilePenLine, History,
  Laptop, Link2, Loader2, Power, RefreshCcw, Settings2, ShieldCheck,
  Trash2, Unplug, UserRound,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { supabaseRpc } from '@/lib/supabaseRpc';

export interface AgentAuditTarget {
  agent_id: string;
  agent_name: string;
  client_name: string | null;
  is_active: boolean;
  is_deleted?: boolean;
}

interface AuditEvent {
  id: string;
  event_type: string;
  category: 'status' | 'configuration' | 'whatsapp' | 'lifecycle' | string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  actor_kind: 'user' | 'service' | 'system' | string;
  source: string;
  auth_session_id: string | null;
  device_id: string | null;
  device_label: string | null;
  browser_name: string | null;
  operating_system: string | null;
  ip_address: string | null;
  changed_fields: string[];
  before_state: Record<string, unknown>;
  after_state: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface AuditResponse {
  agent?: { id: string; name?: string; is_active?: boolean | null; client_name?: string | null; deleted?: boolean };
  events?: AuditEvent[];
  total?: number;
  has_more?: boolean;
}

type Filter = 'all' | 'status' | 'configuration' | 'whatsapp' | 'lifecycle';

const EVENT_META: Record<string, { label: string; tone: string; icon: typeof History }> = {
  audit_baseline: { label: 'Auditoria iniciada', tone: 'text-sky-500 bg-sky-500/10', icon: ShieldCheck },
  agent_created: { label: 'Agente criado', tone: 'text-emerald-500 bg-emerald-500/10', icon: Bot },
  agent_deleted: { label: 'Agente excluído', tone: 'text-red-500 bg-red-500/10', icon: Trash2 },
  agent_activated: { label: 'Agente ativado', tone: 'text-emerald-500 bg-emerald-500/10', icon: Power },
  agent_deactivated: { label: 'Agente desativado', tone: 'text-amber-500 bg-amber-500/10', icon: CircleOff },
  agent_updated: { label: 'Configuração alterada', tone: 'text-violet-500 bg-violet-500/10', icon: Settings2 },
  prompt_updated: { label: 'Prompt alterado', tone: 'text-violet-500 bg-violet-500/10', icon: FilePenLine },
  instance_binding_changed: { label: 'Instância vinculada ou trocada', tone: 'text-cyan-500 bg-cyan-500/10', icon: Link2 },
  whatsapp_instance_created: { label: 'Conexão WhatsApp criada', tone: 'text-cyan-500 bg-cyan-500/10', icon: Cable },
  whatsapp_connected: { label: 'WhatsApp conectado', tone: 'text-emerald-500 bg-emerald-500/10', icon: Cable },
  whatsapp_disconnected: { label: 'WhatsApp desconectado', tone: 'text-red-500 bg-red-500/10', icon: Unplug },
  whatsapp_instance_updated: { label: 'Conexão WhatsApp alterada', tone: 'text-cyan-500 bg-cyan-500/10', icon: Cable },
};

const FIELD_LABEL: Record<string, string> = {
  name: 'Nome do agente',
  is_active: 'Status do agente',
  agent_type: 'Tipo do agente',
  model: 'Modelo de IA',
  temperature: 'Criatividade',
  max_tokens: 'Limite de resposta',
  reply_delay_ms: 'Tempo de resposta',
  company_name: 'Empresa',
  services: 'Serviços',
  address: 'Endereço',
  human_whatsapp: 'WhatsApp humano',
  instance_id: 'Instância principal',
  instance_ids: 'Instâncias vinculadas',
  business_hours_only: 'Horário de atendimento',
  business_hours_start: 'Início do atendimento',
  business_hours_end: 'Fim do atendimento',
  blocked_categories: 'Categorias bloqueadas',
  sdr_goal: 'Objetivo SDR',
  qualification_questions: 'Perguntas de qualificação',
  gerente_feedback_completo: 'Feedback ao gerente',
  mensagens_sem_emoji: 'Mensagens sem emoji',
  automation_rules: 'Regras de automação',
  system_prompt: 'Prompt do agente',
  briefing_template_vendedor: 'Briefing do vendedor',
  briefing_template_gerente: 'Briefing do gerente',
  n8n_webhook_url: 'Webhook n8n',
  whatsapp_instance_id: 'ID da conexão',
  whatsapp_instance_name: 'Nome técnico da conexão',
  whatsapp_friendly_name: 'Nome da conexão',
  whatsapp_phone_number: 'Número conectado',
  whatsapp_provider: 'Provedor WhatsApp',
  whatsapp_status: 'Status do WhatsApp',
  whatsapp_is_active: 'Conexão ativa',
  whatsapp_purpose: 'Finalidade da conexão',
  whatsapp_failover_status: 'Status de contingência',
};

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'Tudo' },
  { key: 'status', label: 'Ativação' },
  { key: 'configuration', label: 'Configuração' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'lifecycle', label: 'Criação e exclusão' },
];

function dateTime(value: string) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function shortId(value: string | null | undefined) {
  if (!value) return '—';
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function stringify(value: unknown, field: string): string {
  if (value == null) return '—';
  if (field === 'is_active') return value === true ? 'Ativo' : 'Desativado';
  if (field === 'whatsapp_is_active') return value === true ? 'Ativa' : 'Inativa';
  if (field === 'business_hours_only') return value === true ? 'Restrito ao horário configurado' : 'Sem restrição de horário';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (field === 'instance_id' || field === 'whatsapp_instance_id') return shortId(String(value));
  if (Array.isArray(value)) return value.length ? value.map((v) => shortId(String(v))).join(', ') : 'Nenhum';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('configured' in obj && 'length' in obj) {
      return obj.configured ? `Configurado · ${Number(obj.length || 0).toLocaleString('pt-BR')} caracteres` : 'Não configurado';
    }
    if ('configured' in obj) return obj.configured ? 'Configurado' : 'Não configurado';
    const raw = JSON.stringify(value);
    return raw.length > 320 ? `${raw.slice(0, 317)}…` : raw;
  }
  return String(value);
}

function actorLabel(event: AuditEvent) {
  if (event.actor_name && event.actor_email) return `${event.actor_name} · ${event.actor_email}`;
  if (event.actor_name) return event.actor_name;
  if (event.actor_email) return event.actor_email;
  if (event.actor_kind === 'service') return 'Serviço/API da plataforma';
  return 'Sistema ou origem não identificada';
}

function eventMeta(event: AuditEvent) {
  return EVENT_META[event.event_type] ?? {
    label: event.event_type.replaceAll('_', ' '),
    tone: 'text-muted-foreground bg-muted',
    icon: Activity,
  };
}

function EventDetails({ event }: { event: AuditEvent }) {
  if (!event.changed_fields?.length) {
    return event.event_type === 'audit_baseline'
      ? <p className="text-xs text-muted-foreground">Estado inicial registrado. Alterações anteriores podem não ter autoria disponível.</p>
      : null;
  }

  return (
    <details className="group mt-3 rounded-lg border border-border/70 bg-muted/20">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-foreground/80">
        Ver {event.changed_fields.length === 1 ? 'alteração' : `${event.changed_fields.length} alterações`}
        <span className="ml-1 text-muted-foreground group-open:hidden">›</span>
      </summary>
      <div className="divide-y divide-border/60 border-t border-border/60 px-3">
        {event.changed_fields.map((field) => (
          <div key={field} className="grid gap-1 py-2.5 text-xs sm:grid-cols-[180px_1fr] sm:gap-3">
            <span className="font-medium text-foreground/80">{FIELD_LABEL[field] ?? field}</span>
            <div className="min-w-0 text-muted-foreground">
              <span className="break-words">{stringify(event.before_state?.[field], field)}</span>
              <span className="mx-2 text-foreground/30">→</span>
              <span className="break-words text-foreground/80">{stringify(event.after_state?.[field], field)}</span>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function TimelineEvent({ event, last }: { event: AuditEvent; last: boolean }) {
  const meta = eventMeta(event);
  const Icon = meta.icon;
  const device = event.device_label
    || [event.operating_system, event.browser_name].filter(Boolean).join(' · ')
    || null;

  return (
    <div className="relative grid grid-cols-[36px_1fr] gap-3 pb-5">
      {!last && <span className="absolute bottom-0 left-[17px] top-9 w-px bg-border" />}
      <div className={cn('relative z-10 flex h-9 w-9 items-center justify-center rounded-full', meta.tone)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 rounded-xl border border-border/80 bg-card px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">{meta.label}</p>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock3 className="h-3 w-3" /> {dateTime(event.created_at)}
            </p>
          </div>
          <Badge variant="outline" className="text-[10px] font-normal">
            {event.category === 'whatsapp' ? 'WhatsApp' : event.category === 'status' ? 'Status' : event.category === 'configuration' ? 'Configuração' : 'Ciclo do agente'}
          </Badge>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" /> {actorLabel(event)}</span>
          {device && <span className="flex items-center gap-1.5"><Laptop className="h-3.5 w-3.5" /> {device}</span>}
          {event.ip_address && <span>IP {event.ip_address}</span>}
        </div>

        <EventDetails event={event} />
      </div>
    </div>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: AgentAuditTarget | null;
}

export default function AgentAuditLogDialog({ open, onOpenChange, agent }: Props) {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    if (!agent?.agent_id) return;
    setLoading(true);
    setError(null);
    try {
      const { data: response, error: rpcError } = await supabaseRpc<AuditResponse>('admin_agent_audit_log', {
        p_agent_id: agent.agent_id,
        p_limit: 150,
      });
      if (rpcError) throw rpcError;
      setData(response || {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message.includes('forbidden') ? 'Acesso restrito aos administradores.' : message);
    } finally {
      setLoading(false);
    }
  }, [agent?.agent_id]);

  useEffect(() => {
    if (open && agent?.agent_id) {
      setFilter('all');
      void load();
    }
  }, [open, agent?.agent_id, load]);

  const events = useMemo(() => {
    const all = Array.isArray(data?.events) ? data!.events! : [];
    return filter === 'all' ? all : all.filter((event) => event.category === filter);
  }, [data, filter]);

  const title = data?.agent?.name || agent?.agent_name || 'Agente';
  const client = data?.agent?.client_name || agent?.client_name;
  const active = data?.agent?.is_active ?? agent?.is_active;
  const deleted = data?.agent?.deleted ?? agent?.is_deleted ?? false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <History className="h-5 w-5 text-primary" /> Histórico do agente · {title}
            </DialogTitle>
            <Badge className={active && !deleted ? 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400' : ''} variant={active && !deleted ? 'default' : 'secondary'}>
              {deleted ? 'Excluído' : active ? 'Ativo' : 'Desativado'}
            </Badge>
          </div>
          <DialogDescription>
            {client ? `${client} · ` : ''}Alterações de configuração, status e conexão registradas na origem.
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-border bg-muted/20 px-5 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((item) => (
                <Button
                  key={item.key}
                  type="button"
                  size="sm"
                  variant={filter === item.key ? 'secondary' : 'ghost'}
                  className="h-8 px-3 text-xs"
                  onClick={() => setFilter(item.key)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCcw className={cn('mr-2 h-3.5 w-3.5', loading && 'animate-spin')} /> Atualizar
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            O navegador não fornece o hostname nem o usuário do Windows. Identificamos a ação pelo login, IP, sessão e navegador/dispositivo.
          </p>
        </div>

        <ScrollArea className="h-[min(64vh,680px)]">
          <div className="px-5 py-5 sm:px-6">
            {loading && !data ? (
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 w-full" />)}
              </div>
            ) : error ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400">
                Não foi possível carregar o histórico. {error}
              </div>
            ) : events.length === 0 ? (
              <div className="flex min-h-48 flex-col items-center justify-center text-center">
                <History className="mb-3 h-9 w-9 text-muted-foreground/40" />
                <p className="text-sm font-medium">Nenhum evento neste filtro</p>
                <p className="mt-1 max-w-md text-xs text-muted-foreground">
                  A auditoria registra novas alterações a partir da implantação. Eventos antigos só aparecem quando já existia uma fonte de auditoria confiável.
                </p>
              </div>
            ) : (
              <>
                {events.map((event, index) => (
                  <TimelineEvent key={event.id} event={event} last={index === events.length - 1} />
                ))}
                {data?.has_more && (
                  <p className="text-center text-xs text-muted-foreground">
                    Exibindo os 150 eventos mais recentes de {Number(data.total || 0).toLocaleString('pt-BR')}.
                  </p>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
