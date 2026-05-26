// ============================================================================
// DashboardTV
// ----------------------------------------------------------------------------
// Dashboard comercial em tempo real pra projetar em TV (fullscreen F11).
// Mostra produção do dia agregando leads do Pedro (ai_crm_leads) +
// Marcos (crm_leads) por vendedor e por origem.
//
// Regras de agregação:
//   • TRÁFEGO PAGO = ai_crm_leads com assigned_to_id IS NOT NULL
//   • PORTA        = crm_leads WHERE origem='porta'
//   • OLX          = crm_leads WHERE origem='olx'
//   • MARKETPLACE  = crm_leads WHERE origem='marketplace'
//   • CONSIGNADO   = crm_leads WHERE origem='consignado'
//   • INDICAÇÃO    = crm_leads WHERE origem='indicacao'
//
// Período: apenas leads do dia atual (created_at >= 00:00 local).
// Atualização: polling a cada 30s + relógio digital atualiza a cada 1s.
// Permissão: APENAS master (vendedor redirecionado pra /dashboard).
// Branding: usa colunas profiles.dashboard_tv_* (configurável na Etapa 3).
//
// Layout inspirado em painel ICOM Motors — mas marca/cores customizáveis.
// ============================================================================

import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { supabase } from '@/integrations/supabase/client';
import { Calendar, Clock, Loader2, Target, DoorOpen, ShoppingBag, Globe, Users, Phone, Trophy } from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────

interface VendedorData {
  id: string;
  name: string;
  profile_picture: string | null;
  rank: number;
  trafico_pago: number;
  porta: number;
  olx: number;
  marketplace: number;
  consignado: number;
  indicacao: number;
  total: number;
}

interface KPIsData {
  total_leads: number;
  por_origem: Record<string, number>;
  percentuais: Record<string, number>;
}

interface BrandingConfig {
  logo_url: string | null;
  company_name: string;
  primary_color: string;
  secondary_color: string;
}

// ─── Config visual das 6 origens (ordem da imagem ICOM) ─────────────────────

const ORIGENS = [
  { key: 'trafico_pago', label: 'Tráfego Pago', icon: Target,      color: '#3b82f6' },
  { key: 'porta',        label: 'Porta',        icon: DoorOpen,    color: '#f59e0b' },
  { key: 'olx',          label: 'OLX',          icon: ShoppingBag, color: '#84cc16' },
  { key: 'marketplace',  label: 'Marketplace',  icon: Globe,       color: '#a855f7' },
  { key: 'indicacao',    label: 'Indicação',    icon: Users,       color: '#fb923c' },
  { key: 'consignado',   label: 'Consignado',   icon: Phone,       color: '#06b6d4' },
] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hashColor(id: string): string {
  // Hash determinístico: mesmo vendedor sempre tem mesma cor de avatar
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  const colors = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'];
  return colors[Math.abs(h) % colors.length];
}

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfToday(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

const RANK_COLORS: Record<number, string> = { 1: '#f59e0b', 2: '#94a3b8', 3: '#cd7f32' };
function rankColor(rank: number): string {
  return RANK_COLORS[rank] || '#475569';
}

// ─── Componente principal ───────────────────────────────────────────────────

export default function DashboardTV() {
  const { user } = useAuth();
  const { isSeller, loading: profileLoading } = useSellerProfile(user?.id);

  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [vendedores, setVendedores] = useState<VendedorData[]>([]);
  const [kpis, setKpis] = useState<KPIsData | null>(null);
  const [branding, setBranding] = useState<BrandingConfig>({
    logo_url: null,
    company_name: 'Painel Comercial',
    primary_color: '#3b82f6',
    secondary_color: '#f59e0b',
  });

  // Relógio digital ao vivo
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Carregar dados (1ª vez + polling 30s)
  useEffect(() => {
    if (!user?.id || profileLoading || isSeller) return;

    let cancelled = false;

    const load = async () => {
      try {
        const todayStart = startOfToday();
        const todayEnd = endOfToday();

        // Roda as 4 queries em paralelo
        const [profileRes, sellersRes, pedroRes, marcosRes] = await Promise.all([
          (supabase as any)
            .from('profiles')
            .select('dashboard_tv_logo_url, dashboard_tv_company_name, dashboard_tv_primary_color, dashboard_tv_secondary_color, full_name, company_name')
            .eq('id', user.id)
            .maybeSingle(),
          (supabase as any)
            .from('ai_team_members')
            .select('id, name, profile_picture')
            .eq('user_id', user.id)
            .eq('is_active', true),
          (supabase as any)
            .from('ai_crm_leads')
            .select('id, assigned_to_id')
            .eq('user_id', user.id)
            .not('assigned_to_id', 'is', null)
            .gte('created_at', todayStart)
            .lte('created_at', todayEnd),
          (supabase as any)
            .from('crm_leads')
            .select('id, origem, assigned_to')
            .eq('user_id', user.id)
            .gte('created_at', todayStart)
            .lte('created_at', todayEnd),
        ]);

        if (cancelled) return;

        // 1. Branding (com fallbacks razoáveis)
        const p = profileRes.data || {};
        setBranding({
          logo_url: p.dashboard_tv_logo_url || null,
          company_name: p.dashboard_tv_company_name || p.company_name || p.full_name || 'Painel Comercial',
          primary_color: p.dashboard_tv_primary_color || '#3b82f6',
          secondary_color: p.dashboard_tv_secondary_color || '#f59e0b',
        });

        // 2. Inicializa agregador por vendedor (todos os ativos)
        const sellers = (sellersRes.data || []) as Array<{ id: string; name: string; profile_picture: string | null }>;
        const agg: Record<string, VendedorData> = {};
        for (const s of sellers) {
          agg[s.id] = {
            id: s.id, name: s.name, profile_picture: s.profile_picture, rank: 0,
            trafico_pago: 0, porta: 0, olx: 0, marketplace: 0, consignado: 0, indicacao: 0, total: 0,
          };
        }

        // 3. Pedro: cada lead com assigned_to_id conta como trafico_pago
        for (const l of (pedroRes.data || []) as any[]) {
          const v = agg[l.assigned_to_id];
          if (v) { v.trafico_pago++; v.total++; }
        }

        // 4. Marcos: agrupa por origem (apenas as 5 categorias mostradas; instagram/outros não contam)
        for (const l of (marcosRes.data || []) as any[]) {
          const v = agg[l.assigned_to];
          if (!v) continue;
          const o = l.origem as string;
          if (o === 'porta')           { v.porta++;       v.total++; }
          else if (o === 'olx')        { v.olx++;         v.total++; }
          else if (o === 'marketplace'){ v.marketplace++; v.total++; }
          else if (o === 'consignado') { v.consignado++;  v.total++; }
          else if (o === 'indicacao')  { v.indicacao++;   v.total++; }
          // instagram/outros/null: deliberadamente NÃO contam no total (não estão no dashboard)
        }

        // 5. Rank por total desc, tie-breaker alfabético
        const sorted = Object.values(agg)
          .sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name))
          .map((v, i) => ({ ...v, rank: i + 1 }));
        setVendedores(sorted);

        // 6. KPIs gerais
        const porOrigem: Record<string, number> = {
          trafico_pago: 0, porta: 0, olx: 0, marketplace: 0, consignado: 0, indicacao: 0,
        };
        for (const v of sorted) {
          porOrigem.trafico_pago += v.trafico_pago;
          porOrigem.porta        += v.porta;
          porOrigem.olx          += v.olx;
          porOrigem.marketplace  += v.marketplace;
          porOrigem.consignado   += v.consignado;
          porOrigem.indicacao    += v.indicacao;
        }
        const total = Object.values(porOrigem).reduce((a, b) => a + b, 0);
        const percentuais: Record<string, number> = {};
        for (const k of Object.keys(porOrigem)) {
          percentuais[k] = total > 0 ? Math.round((porOrigem[k] / total) * 1000) / 10 : 0;
        }
        setKpis({ total_leads: total, por_origem: porOrigem, percentuais });
      } catch (err) {
        console.error('[DashboardTV] erro ao carregar:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const t = setInterval(load, 30_000); // poll a cada 30s
    return () => { cancelled = true; clearInterval(t); };
  }, [user?.id, profileLoading, isSeller]);

  // Vendedor logado é redirecionado (master only)
  if (!profileLoading && isSeller) {
    return <Navigate to="/dashboard" replace />;
  }

  // Loading inicial (perfil + dados)
  if (profileLoading || (loading && !kpis)) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-blue-400" />
      </div>
    );
  }

  const dateStr = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white overflow-hidden">
      {/* ───── Header ───── */}
      <header className="border-b border-blue-900/50 px-8 py-4 flex items-center justify-between bg-slate-900/40 backdrop-blur">
        <div className="flex items-center gap-5">
          {branding.logo_url ? (
            <img src={branding.logo_url} alt="logo" className="h-14 w-auto object-contain" />
          ) : (
            <div
              className="h-14 w-14 rounded-xl flex items-center justify-center font-bold text-2xl"
              style={{ background: `linear-gradient(135deg, ${branding.primary_color}, ${branding.secondary_color})` }}
            >
              {(branding.company_name || '?')[0]?.toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-black uppercase tracking-wider">{branding.company_name}</h1>
            <p className="text-xs uppercase tracking-widest text-blue-300/70 mt-0.5">Dashboard Comercial · Produção em Tempo Real</p>
          </div>
        </div>
        <div className="flex items-center gap-8 text-right">
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-widest text-blue-300/60 flex items-center gap-1.5">
              <Calendar className="h-3 w-3" /> Data
            </span>
            <span className="text-base font-bold tabular-nums">{dateStr}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-widest text-blue-300/60 flex items-center gap-1.5">
              <Clock className="h-3 w-3" /> Hora
            </span>
            <span className="text-base font-bold tabular-nums">{timeStr}</span>
          </div>
        </div>
      </header>

      {/* ───── Bloco LEADS GERAIS + ORIGEM ───── */}
      <section className="px-8 py-6 grid grid-cols-12 gap-4">
        {/* Total geral */}
        <div className="col-span-3 bg-slate-900/60 rounded-2xl p-6 border border-blue-900/40 flex flex-col items-center justify-center text-center">
          <Users className="h-7 w-7 text-blue-400 mb-2" />
          <p className="text-[10px] uppercase tracking-widest text-blue-300/70 mb-2 font-semibold">Leads Gerais do Dia</p>
          <p className="text-7xl font-black tabular-nums leading-none" style={{ color: branding.primary_color }}>
            {kpis?.total_leads ?? 0}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-blue-300/50 mt-3">Total de Leads</p>
        </div>

        {/* 6 origens */}
        <div className="col-span-9">
          <h2 className="text-[10px] uppercase tracking-widest text-blue-300/70 mb-3 font-bold">Origem dos Leads</h2>
          <div className="grid grid-cols-6 gap-3">
            {ORIGENS.map(origem => {
              const Icon = origem.icon;
              const valor = kpis?.por_origem[origem.key] ?? 0;
              const pct = kpis?.percentuais[origem.key] ?? 0;
              return (
                <div key={origem.key} className="bg-slate-900/60 rounded-xl p-4 border border-slate-800 hover:border-slate-700 transition-colors">
                  <Icon className="h-5 w-5 mb-2" style={{ color: origem.color }} />
                  <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1 truncate">{origem.label}</p>
                  <p className="text-3xl font-black tabular-nums leading-none">{valor}</p>
                  <p className="text-[10px] text-slate-500 mt-1.5">{pct.toFixed(2)}%</p>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1.5">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%`, background: origem.color }} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-center text-[10px] text-slate-500 italic mt-2">Dados atualizados automaticamente em tempo real via CRM</p>
        </div>
      </section>

      {/* ───── PRODUÇÃO INDIVIDUAL DOS VENDEDORES ───── */}
      <section className="px-8 pb-20">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-[10px] uppercase tracking-widest text-blue-300/70 font-bold">Produção Individual dos Vendedores</h2>
          <p className="text-[10px] text-slate-500 italic">Total de Leads Trabalhados</p>
        </div>

        {vendedores.length === 0 ? (
          <div className="text-center text-slate-500 py-16 bg-slate-900/40 rounded-xl border border-slate-800">
            Nenhum vendedor ativo. Cadastre vendedores em Pedro SDR → Vendedores.
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-3">
            {vendedores.slice(0, 10).map(v => (
              <VendedorCard key={v.id} v={v} secondary={branding.secondary_color} />
            ))}
          </div>
        )}
      </section>

      {/* ───── Destaque do Dia (fixed bottom) ───── */}
      {vendedores[0] && vendedores[0].total > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-400/40 rounded-full px-6 py-2.5 flex items-center gap-3 backdrop-blur shadow-2xl">
          <Trophy className="h-5 w-5 text-amber-400" />
          <span className="text-[10px] uppercase tracking-widest font-bold text-amber-300">Destaque do Dia</span>
          <span className="text-sm font-bold">{vendedores[0].name}</span>
          <span className="text-xs text-amber-300/80 font-semibold">· {vendedores[0].total} leads</span>
        </div>
      )}
    </div>
  );
}

// ─── Card individual de vendedor ────────────────────────────────────────────

function VendedorCard({ v, secondary }: { v: VendedorData; secondary: string }) {
  const rColor = rankColor(v.rank);
  const avatarColor = hashColor(v.id);

  return (
    <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-800">
      {/* Header: rank + nome */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="text-xs font-bold tabular-nums px-2 py-0.5 rounded-md"
          style={{ color: rColor, background: `${rColor}22`, border: `1px solid ${rColor}44` }}
        >
          {v.rank}º
        </span>
        <span className="text-sm font-bold uppercase truncate flex-1">{v.name}</span>
      </div>

      {/* Avatar */}
      <div className="flex justify-center mb-3">
        {v.profile_picture ? (
          <img
            src={v.profile_picture}
            alt={v.name}
            className="h-16 w-16 rounded-full object-cover border-2"
            style={{ borderColor: rColor }}
          />
        ) : (
          <div
            className="h-16 w-16 rounded-full flex items-center justify-center font-bold text-xl border-2 text-white"
            style={{ background: avatarColor, borderColor: rColor }}
          >
            {getInitials(v.name)}
          </div>
        )}
      </div>

      {/* Breakdown por origem */}
      <div className="space-y-1">
        <BreakdownRow label="Tráfego Pago" value={v.trafico_pago} color="#3b82f6" />
        <BreakdownRow label="Porta"        value={v.porta}        color="#f59e0b" />
        <BreakdownRow label="OLX"          value={v.olx}          color="#84cc16" />
        <BreakdownRow label="Marketplace"  value={v.marketplace}  color="#a855f7" />
        <BreakdownRow label="Consignado"   value={v.consignado}   color="#06b6d4" />
        <BreakdownRow label="Indicação"    value={v.indicacao}    color="#fb923c" />
      </div>

      {/* Total */}
      <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Total</span>
        <span className="text-2xl font-black tabular-nums" style={{ color: secondary }}>{v.total}</span>
      </div>
    </div>
  );
}

function BreakdownRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
      <span className="flex-1 text-slate-400 truncate">{label}</span>
      <span className="font-bold tabular-nums" style={{ color: value > 0 ? '#ffffff' : '#475569' }}>{value}</span>
    </div>
  );
}
