import { useMemo } from 'react';
import { CheckCircle2, Clock3, Info, Route, ShieldCheck, Users } from 'lucide-react';

type RotationMember = {
  id: string;
  name?: string | null;
  whatsapp_number?: string | null;
  is_active?: boolean | null;
  active_in_system?: boolean | null;
  agent_id?: string | null;
  last_lead_received_at?: string | null;
};

type RotationTransfer = {
  id: string;
  to_member_id?: string | null;
  transfer_status?: string | null;
  transfer_reason?: string | null;
  created_at: string;
  member?: { name?: string | null } | null;
};

type DateFilter = 'today' | '7d' | '30d' | '90d' | 'all' | 'custom';

type Props = {
  members: RotationMember[];
  transfers: RotationTransfer[];
  nextSeller?: RotationMember | null;
  dateFilter: DateFilter;
  customStart?: string;
  customEnd?: string;
  agentId?: string | null;
};

const COLORS = ['#6DE7C7', '#7CB9FF', '#F8C76D', '#C89BFF'];

function phoneKey(raw?: string | null) {
  const digits = String(raw || '').replace(/\D/g, '');
  const local = digits.startsWith('55') ? digits.slice(2) : digits;
  return local.length === 11 && local[2] === '9' ? `${local.slice(0, 2)}${local.slice(3)}` : local.slice(-10);
}

function thresholdFor(filter: DateFilter, customStart?: string) {
  if (filter === 'all') return null;
  if (filter === 'custom') return customStart ? new Date(`${customStart}T00:00:00`) : null;
  const days = filter === 'today' ? 0 : filter === '7d' ? 7 : filter === '30d' ? 30 : 90;
  const date = new Date();
  if (days === 0) return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function reasonInfo(raw?: string | null) {
  const reason = String(raw || '').toLowerCase();
  if (/followup|timeout|rodizio|inatividade/.test(reason)) return { label: 'Retorno / timeout', color: '#F8C76D', repeat: true };
  if (/orphan|órfão|orfao|rescue|resgate/.test(reason)) return { label: 'Resgate', color: '#C89BFF', repeat: true };
  if (/return|retorno|renotify|silence|silencio|closure/.test(reason)) return { label: 'Lead que voltou', color: '#F8C76D', repeat: true };
  if (reason === 'manual') return { label: 'Manual', color: '#94A3B8', repeat: false };
  return { label: 'Entrada / qualificação', color: '#6DE7C7', repeat: false };
}

function periodLabel(filter: DateFilter, customStart?: string, customEnd?: string) {
  if (filter === 'today') return 'hoje';
  if (filter === '7d') return 'últimos 7 dias';
  if (filter === '30d') return 'últimos 30 dias';
  if (filter === '90d') return 'últimos 90 dias';
  if (filter === 'custom') return `${customStart || '?'} → ${customEnd || '?'}`;
  return 'todo o histórico carregado';
}

export function RotationAuditPanel({ members, transfers, nextSeller, dateFilter, customStart, customEnd, agentId }: Props) {
  const threshold = thresholdFor(dateFilter, customStart);

  const eligible = useMemo(() => {
    const byPhone = new Map<string, RotationMember>();
    for (const member of members) {
      if (member.is_active !== true || member.active_in_system === false || !phoneKey(member.whatsapp_number)) continue;
      if (agentId && member.agent_id !== agentId) continue;
      const key = phoneKey(member.whatsapp_number);
      const current = byPhone.get(key);
      if (!current || new Date(member.last_lead_received_at || 0).getTime() > new Date(current.last_lead_received_at || 0).getTime()) {
        byPhone.set(key, member);
      }
    }
    return [...byPhone.values()].sort((a, b) =>
      new Date(a.last_lead_received_at || 0).getTime() - new Date(b.last_lead_received_at || 0).getTime(),
    );
  }, [members, agentId]);

  const idsByPhone = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const member of members) {
      const key = phoneKey(member.whatsapp_number) || member.id;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)?.add(member.id);
    }
    return map;
  }, [members]);

  const events = useMemo(() => transfers
    .filter((transfer) => transfer.transfer_status === 'confirmed')
    .filter((transfer) => !threshold || new Date(transfer.created_at) >= threshold)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [transfers, threshold]);

  const stats = useMemo(() => eligible.map((member, index) => {
    const ids = idsByPhone.get(phoneKey(member.whatsapp_number)) || new Set([member.id]);
    const count = events.filter((event) => event.to_member_id && ids.has(event.to_member_id)).length;
    return { ...member, count, color: COLORS[index % COLORS.length] };
  }), [eligible, events, idsByPhone]);

  const total = stats.reduce((sum, seller) => sum + seller.count, 0);
  const largest = Math.max(0, ...stats.map((seller) => seller.count));
  const smallest = stats.length ? Math.min(...stats.map((seller) => seller.count)) : 0;
  const difference = largest - smallest;
  const isBalanced = total === 0 || difference <= Math.max(2, Math.ceil(total * 0.15));
  const repeated = events.filter((event) => reasonInfo(event.transfer_reason).repeat).length;
  const manual = events.filter((event) => reasonInfo(event.transfer_reason).label === 'Manual').length;
  const automatic = events.length - repeated - manual;

  return (
    <section
      aria-label="Auditoria do rodízio do Pedro"
      style={{
        borderRadius: 18,
        border: `1px solid ${isBalanced ? 'rgba(109,231,199,0.42)' : 'rgba(248,199,109,0.58)'}`,
        background: 'linear-gradient(135deg, rgba(15,31,48,0.98), rgba(15,24,40,0.96))',
        boxShadow: '0 18px 45px rgba(0,0,0,0.18)',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '18px 20px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6DE7C7', fontSize: 10, fontWeight: 850, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            <Route size={15} /> Prova visual da fila
          </div>
          <h2 style={{ margin: '6px 0 0', color: '#F8FAFC', fontSize: 21, fontWeight: 900 }}>Rodízio do Pedro</h2>
          <p style={{ margin: '5px 0 0', color: '#94A3B8', fontSize: 12, lineHeight: 1.45 }}>
            {periodLabel(dateFilter, customStart, customEnd)} · somente vendedores ativos e confirmados
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, borderRadius: 999, padding: '8px 11px', color: isBalanced ? '#6DE7C7' : '#F8C76D', background: isBalanced ? 'rgba(109,231,199,0.11)' : 'rgba(248,199,109,0.12)', border: `1px solid ${isBalanced ? 'rgba(109,231,199,0.28)' : 'rgba(248,199,109,0.3)'}`, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>
          {isBalanced ? <ShieldCheck size={15} /> : <Info size={15} />}
          {isBalanced ? 'Fila equilibrada' : 'Revisar diferença'}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1, background: 'rgba(255,255,255,0.08)' }}>
        {[
          { label: 'Vendedores na fila', value: eligible.length, icon: <Users size={16} />, color: '#7CB9FF' },
          { label: 'Encaminhamentos confirmados', value: total, icon: <CheckCircle2 size={16} />, color: '#6DE7C7' },
          { label: 'Diferença entre maiores e menores', value: difference, icon: <Clock3 size={16} />, color: '#F8C76D' },
        ].map((metric) => (
          <div key={metric.label} style={{ padding: '13px 16px', background: 'rgba(8,15,28,0.34)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: metric.color, fontSize: 11, fontWeight: 750 }}>{metric.icon} {metric.label}</div>
            <strong style={{ display: 'block', marginTop: 6, color: '#F8FAFC', fontSize: 24, lineHeight: 1 }}>{metric.value}</strong>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(220px, .9fr)', gap: 20, padding: 20 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0, color: '#F8FAFC', fontSize: 14, fontWeight: 850 }}>Divisão real dos encaminhamentos</h3>
              <p style={{ margin: '4px 0 0', color: '#64748B', fontSize: 11 }}>O rodízio não precisa alternar a cada mensagem para estar balanceado.</p>
            </div>
            <span style={{ color: '#6DE7C7', fontSize: 11, fontWeight: 800 }}>{nextSeller ? `próximo: ${nextSeller.name}` : 'sem próximo definido'}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {stats.length === 0 ? <p style={{ margin: 0, color: '#94A3B8', fontSize: 12 }}>Nenhum vendedor ativo com telefone válido.</p> : stats.map((seller) => {
              const share = total ? Math.round((seller.count / total) * 100) : 0;
              return (
                <div key={seller.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: '#E2E8F0', fontSize: 12, fontWeight: 800 }}>
                    <span>{seller.name || 'Vendedor'}</span>
                    <span style={{ color: seller.color }}>{seller.count} · {share}%</span>
                  </div>
                  <div style={{ height: 9, marginTop: 7, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                    <div style={{ width: `${share}%`, height: '100%', borderRadius: 99, background: `linear-gradient(90deg, ${seller.color}, rgba(255,255,255,0.72))`, transition: 'width 500ms ease' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ borderLeft: '1px solid rgba(255,255,255,0.08)', paddingLeft: 20 }}>
          <h3 style={{ margin: 0, color: '#F8FAFC', fontSize: 14, fontWeight: 850 }}>Por que pode parecer repetido?</h3>
          <p style={{ margin: '7px 0 15px', color: '#94A3B8', fontSize: 12, lineHeight: 1.55 }}>
            Retornos do mesmo contato preservam o vendedor anterior. Timeouts e resgates são recuperações de uma conversa já existente, não novos leads da fila.
          </p>
          <div style={{ display: 'grid', gap: 9 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: '#6DE7C7', fontSize: 12, fontWeight: 800 }}><span>Automático / qualificação</span><span>{automatic}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: '#94A3B8', fontSize: 12, fontWeight: 800 }}><span>Manual</span><span>{manual}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: '#F8C76D', fontSize: 12, fontWeight: 800 }}><span>Retorno / timeout / resgate</span><span>{repeated}</span></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, padding: '10px 11px', borderRadius: 10, background: 'rgba(124,185,255,0.08)', border: '1px solid rgba(124,185,255,0.18)', color: '#B8D7FF', fontSize: 11, lineHeight: 1.45 }}>
            <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            A fila elegível é formada pelos vendedores ativos. Gerentes, vendedores desligados e duplicatas do mesmo telefone ficam fora.
          </div>
        </div>
      </div>

      <div style={{ padding: '0 20px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 9 }}>
          <h3 style={{ margin: 0, color: '#F8FAFC', fontSize: 14, fontWeight: 850 }}>Últimos eventos confirmados</h3>
          <span style={{ color: '#64748B', fontSize: 11 }}>a ordem abaixo é cronológica, não uma promessa de alternância</span>
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 3 }}>
          {events.slice(0, 8).map((event) => {
            const info = reasonInfo(event.transfer_reason);
            return (
              <div key={event.id} style={{ minWidth: 156, flex: '1 0 156px', padding: '10px 11px', borderRadius: 10, border: `1px solid ${info.color}55`, background: `${info.color}12`, transition: 'transform 180ms ease, border-color 180ms ease' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 7 }}>
                  <strong style={{ color: info.color, fontSize: 12 }}>{event.member?.name || 'Vendedor'}</strong>
                  <span style={{ color: '#64748B', fontSize: 10 }}>{new Date(event.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p style={{ margin: '5px 0 0', color: '#CBD5E1', fontSize: 10.5 }}>{info.label}</p>
              </div>
            );
          })}
          {events.length === 0 && <p style={{ margin: 0, color: '#64748B', fontSize: 12 }}>Ainda não há encaminhamentos confirmados neste recorte.</p>}
        </div>
      </div>
    </section>
  );
}
