import {
  Home,
  BarChart3,
  MonitorPlay,
  Brain,
  PenTool,
  Palette,
  Plug,
  Settings,
  Sparkles,
  Moon,
  Sun,
  X,
  LogOut,
  Send,
  Inbox,
  Zap,
  Smartphone,
  Radar,
  Instagram,
  CreditCard,
  Kanban,
  FileText,
  ClipboardList,
  ChevronDown,
  Mail,
  Users,
  GraduationCap,
  Bot,
  ShieldCheck,
  Activity,
} from 'lucide-react';
import { TokenWidgetCompact } from '@/components/subscription/TokenWidget';
import { LogosIAIcon, LogosIALogo } from '@/components/brand/LogosIALogo';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { useAuth } from '@/hooks/useAuth';
// Fase 6.5f: badge contador de pendentes em "Campos Dinâmicos"
import { useDynamicFieldsBadge } from '@/hooks/useDynamicFieldsBadge';
import { NavLink } from '@/components/NavLink';
import { Badge } from '@/components/ui/badge';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { useState } from 'react';
import { useSellerProfile, type VisibleFeatures } from '@/hooks/useSellerProfile';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { useSubscription } from '@/hooks/useSubscription';
import { FEATURES } from '@/config/features';

const BRUNO_LIRA_USER_ID = 'f49fd48a-4386-4009-95f3-26a5100b84f7';

// ── Agentes (sem Pedro e Marcos — têm navegação própria expandível) ───────────
const agentItems = [
  { title: 'Salomão', subtitle: 'Orquestrador', url: '/salomao',         icon: Sparkles,  emoji: '👑' },
  { title: 'José',    subtitle: 'Tráfego Pago',  url: '/jose',           icon: Radar,     emoji: '🎯' },
  { title: 'Paulo',   subtitle: 'Copywriter',    url: '/copywriter',     icon: PenTool,   emoji: '✍️' },
  { title: 'Maria',   subtitle: 'Design',        url: '/creative-studio',icon: Palette,   emoji: '🎨' },
  { title: 'Davi',    subtitle: 'Social Media',  url: '/davi',           icon: Instagram, emoji: '📱' },
  { title: 'João',    subtitle: 'E-mail',        url: '/joao',           icon: Mail,      emoji: '📧' },
  { title: 'Daniel',  subtitle: 'Estratégia',    url: '/daniel',         icon: Brain,     emoji: '🧠' },
];

// 29/05/2026: allPedroSellerSubItems REMOVIDO. O vendedor não usa mais submenu
// expansível do Pedro — vai direto pra /pedro (igual ao master). As abas internas
// do PedroSDR já filtram por visibleFeatures (ALL_SELLER_TABS), então o acesso é
// preservado sem duplicar os itens no sidebar.

// ── Sistema Seller — filtrados por visibleFeatures ──────────────────────────
// Dashboard NÃO fica aqui — já é tratado separadamente no grupo "Painel"
const allSellerSystemItems = [
  { title: 'Treinamento',    url: '/treinamento',  icon: GraduationCap,   featureKey: 'sidebar_treinamento' as keyof VisibleFeatures },
  { title: 'Meu Plano',      url: '/meu-plano',    icon: CreditCard,      featureKey: 'sidebar_meu_plano' as keyof VisibleFeatures },
  { title: 'Integrações',    url: '/integrations', icon: Plug,            featureKey: 'sidebar_integracoes' as keyof VisibleFeatures },
  // Configurações saiu daqui — agora fica fixo no rodapé (respeitando a permissão).
];

// ── Agentes Seller — filtrados por visibleFeatures (unificado com Dashboard) ─
const allSellerAgentItems: { title: string; url: string; icon: any; featureKey: keyof VisibleFeatures }[] = [
  { title: 'José Tráfego Pago',    url: '/jose',            icon: Radar,     featureKey: 'agent_jose' },
  { title: 'Salomão Orquestrador', url: '/salomao',         icon: Sparkles,  featureKey: 'agent_salomao' },
  { title: 'Paulo Copywriting',    url: '/copywriter',      icon: PenTool,   featureKey: 'agent_paulo' },
  { title: 'Maria Designer',       url: '/creative-studio', icon: Palette,   featureKey: 'agent_maria' },
  { title: 'Davi Social Mídia',    url: '/davi',            icon: Instagram, featureKey: 'agent_davi' },
  { title: 'João E-mail MKT',      url: '/joao',            icon: Mail,      featureKey: 'agent_joao' },
  { title: 'Daniel Estrategista',  url: '/daniel',          icon: Brain,     featureKey: 'agent_daniel' },
];

// ── Marcos — sub-itens Leads & WhatsApp ──────────────────────────────────────
const marcosSubItems: { title: string; url: string; icon: any; featureKey: keyof VisibleFeatures }[] = [
  { title: 'Performance',     url: '/marcos?tab=performance', icon: BarChart3,     featureKey: 'marcos_crm' },
  { title: 'CRM',             url: '/crm',               icon: Kanban,        featureKey: 'marcos_crm' },
  { title: 'Formulários',     url: '/crm/formularios',   icon: ClipboardList, featureKey: 'marcos_formularios' },
  { title: 'Contatos',        url: '/whatsapp/contacts', icon: Users,         featureKey: 'marcos_contatos' },
  { title: 'Disparo em Massa',url: '/whatsapp/broadcast',icon: Send,          featureKey: 'marcos_disparo' },
  { title: 'Inbox',           url: '/whatsapp/inbox',    icon: Inbox,         featureKey: 'marcos_inbox' },
  { title: 'Instâncias',      url: '/whatsapp/instances',icon: Smartphone,    featureKey: 'marcos_instancias' },
  { title: 'Automações',      url: '/whatsapp/automations',icon: Zap,         featureKey: 'marcos_automacoes' },
].filter(item =>
  // TAREFA 4 (29/05/2026): Automação OCULTA do menu lateral enquanto
  // FEATURES.automacao = false. Filtra aqui na definição → some dos 3
  // consumidores (master, vendedor e showMarcosSeller) de uma vez.
  item.url !== '/whatsapp/automations' || FEATURES.automacao
);

// ── Sistema ───────────────────────────────────────────────────────────────────
const systemItems = [
  { title: 'Treinamento',      url: '/treinamento',   icon: GraduationCap },
  { title: 'Meu Plano',        url: '/meu-plano',     icon: CreditCard },
  { title: 'Integrações',      url: '/integrations',  icon: Plug },
  // Meu Perfil e Configurações saíram daqui — agora ficam fixos no rodapé.
  // Fase 6.5 — gerencia cidades + origens dinâmicas
  { title: 'Campos Dinâmicos', url: '/configuracoes/campos-dinamicos', icon: Sparkles },
];

// ── NavItem simples ────────────────────────────────────────────────────────────
function NavItem({
  item, collapsed,
}: {
  item: { title: string; url: string; icon: React.ComponentType<{ className?: string }>; badge?: number };
  collapsed?: boolean;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={item.title}>
        <NavLink
          to={item.url}
          end={item.url === '/dashboard' || item.url === '/tela-inicial'}
          className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-all hover:bg-accent/60 hover:text-foreground"
          activeClassName="bg-primary/10 text-primary font-medium border-l-2 border-primary pl-[9px]"
        >
          <item.icon className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="flex-1 truncate">{item.title}</span>}
          {!collapsed && (item.badge || 0) > 0 && (
            <Badge className="ml-auto h-4 min-w-4 rounded-full px-1 text-[9px] bg-primary text-primary-foreground border-0">
              {item.badge}
            </Badge>
          )}
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

// ── NavAgent (com emoji + subtitle) ───────────────────────────────────────────
function NavAgent({
  item, collapsed,
}: {
  item: typeof agentItems[0];
  collapsed?: boolean;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={`${item.title} — ${item.subtitle}`}>
        <NavLink
          to={item.url}
          className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-all hover:bg-accent/60 hover:text-foreground"
          activeClassName="bg-primary/10 text-primary font-medium border-l-2 border-primary pl-[9px]"
        >
          {collapsed ? (
            <span className="text-base leading-none">{item.emoji}</span>
          ) : (
            <>
              <span className="text-sm leading-none w-5 text-center">{item.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-tight truncate">{item.title}</p>
                <p className="text-[10px] text-muted-foreground/70 leading-tight">{item.subtitle}</p>
              </div>
            </>
          )}
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

// ── NavMarcosExpandable — Marcos com sub-itens Leads & WhatsApp ──────────────
function NavMarcosExpandable({ collapsed }: { collapsed?: boolean }) {
  const { openSidebarGroups, toggleSidebarGroup } = useAppStore();
  const key = 'marcos-sub';
  const isOpen = openSidebarGroups.includes(key);

  if (collapsed) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild tooltip="Marcos — CRM & Leads">
          <NavLink
            to="/crm"
            className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-all hover:bg-accent/60 hover:text-foreground"
            activeClassName="bg-primary/10 text-primary font-medium border-l-2 border-primary pl-[9px]"
          >
            <span className="text-base leading-none">🤝</span>
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      {/* Cabeçalho do Marcos — clicável para expandir */}
      <div
        className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground cursor-pointer hover:bg-accent/60 hover:text-foreground transition-all select-none"
        onClick={() => toggleSidebarGroup(key)}
      >
        <span className="text-sm leading-none w-5 text-center">🤝</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-tight">Marcos</p>
          <p className="text-[10px] text-muted-foreground/70 leading-tight">CRM & Leads</p>
        </div>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-0' : '-rotate-90'}`} />
      </div>

      {/* Sub-itens */}
      {isOpen && (
        <div className="ml-4 mt-0.5 border-l border-border/40 pl-2 space-y-0.5">
          {marcosSubItems.map(sub => (
            <NavLink
              key={sub.url}
              to={sub.url}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-all"
              activeClassName="text-primary font-medium bg-primary/10"
            >
              <sub.icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{sub.title}</span>
            </NavLink>
          ))}
        </div>
      )}
    </SidebarMenuItem>
  );
}

// 29/05/2026: NavMarcosSellerExpandable e NavPedroSellerExpandable REMOVIDOS.
// O vendedor agora usa NavItem direto (igual ao master) — ver grupo "Agentes" do
// vendedor no render abaixo. O acesso continua filtrado dentro das páginas
// (ALL_SELLER_TABS no PedroSDR, tabs em MarcosLeads), não no sidebar.

// ── NavGroup colapsável ────────────────────────────────────────────────────────
function NavGroup({
  label, children, defaultOpen = true, collapsed,
}: {
  label: string; children: React.ReactNode; defaultOpen?: boolean; collapsed?: boolean;
}) {
  const { openSidebarGroups, toggleSidebarGroup } = useAppStore();
  const isOpen = openSidebarGroups.includes(label);

  if (collapsed) {
    return (
      <SidebarGroup className="py-1">
        <SidebarGroupContent>
          <SidebarMenu>{children}</SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={() => toggleSidebarGroup(label)}>
      <SidebarGroup className="py-0.5">
        <CollapsibleTrigger asChild>
          <SidebarGroupLabel className="flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 cursor-pointer hover:text-muted-foreground transition-colors select-none">
            {label}
            <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-0' : '-rotate-90'}`} />
          </SidebarGroupLabel>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>{children}</SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

// ── Main Sidebar ───────────────────────────────────────────────────────────────
export function AppSidebar() {
  const { isDarkMode, toggleDarkMode } = useAppStore();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === 'collapsed';
  const { isSeller, visibleFeatures, loading: sellerLoading } = useSellerProfile(user?.id);
  const { isAdmin } = useIsAdmin();
  // Fase 6.5f: badge contador de pendentes (só master vê — vendedor não tem acesso à tela)
  const dynamicFieldsPendingCount = useDynamicFieldsBadge(!isSeller ? user?.id : null);
  const { subscription } = useSubscription();
  const userPlan = isAdmin ? 'enterprise' : (subscription?.plan_id || 'basico');
  const hasBrunoManualRelease = user?.id === BRUNO_LIRA_USER_ID;
  const showMarcos = hasBrunoManualRelease || userPlan === 'pro' || userPlan === 'enterprise';
  const showJose = hasBrunoManualRelease || userPlan === 'pro' || userPlan === 'enterprise';
  const showEnterprise = userPlan === 'enterprise';

  const handleLogout = async () => {
    await signOut();
    navigate('/auth');
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border/40">

      {/* ── Logo ── */}
      <SidebarHeader className="border-b border-border/40 p-3">
        {collapsed ? (
          <div className="flex justify-center">
            <button
              onClick={toggleSidebar}
              className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-accent/50 transition-colors"
            >
              <LogosIAIcon size={28} variant="dark" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <LogosIALogo size="sm" variant="dark" />
            <button
              onClick={toggleSidebar}
              className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-accent transition-colors"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className={`py-2 ${collapsed ? 'px-1' : 'px-2'}`}>

        {sellerLoading ? null : isSeller ? (
          /* ── SELLER: tudo agrupado em "Agentes" filtrado por visibleFeatures ── */
          <>
            {(visibleFeatures.sidebar_dashboard || visibleFeatures.sidebar_painel_geral) && (
              <NavGroup label="Painel" collapsed={collapsed}>
                {visibleFeatures.sidebar_dashboard && (
                  <>
                    <NavItem collapsed={collapsed} item={{ title: 'Tela inicial', url: '/tela-inicial', icon: Home }} />
                    {/* [Unificado] item "Dashboard" removido — virou parte do Painel Geral. */}
                  </>
                )}
                {/* 29/05/2026: Painel Geral também no vendedor (igual ao master),
                    liberado pelo master via sidebar_painel_geral. A página re-escopa
                    pra mostrar SÓ os leads do próprio vendedor (ranking de colegas oculto). */}
                {visibleFeatures.sidebar_painel_geral && (
                  <NavItem collapsed={collapsed} item={{ title: 'Painel Geral', url: '/painel-geral', icon: BarChart3 }} />
                )}
                {/* Painel ao Vivo — do sistema; respeita a permissão do vendedor. */}
                {visibleFeatures.tab_crm_ao_vivo && (
                  <NavItem collapsed={collapsed} item={{ title: 'Painel ao Vivo', url: '/painel-ao-vivo', icon: MonitorPlay }} />
                )}
              </NavGroup>
            )}

            {(() => {
              const showPedro  = visibleFeatures.agent_pedro;
              const showMarcosSeller = visibleFeatures.agent_marcos && marcosSubItems.some(i => visibleFeatures[i.featureKey]);
              const sellerExtraAgents = allSellerAgentItems.filter(i => visibleFeatures[i.featureKey]);
              const anyAgent = showPedro || showMarcosSeller || sellerExtraAgents.length > 0;
              if (!anyAgent) return null;
              return (
                <NavGroup label="Agentes" collapsed={collapsed}>
                  {/* 29/05/2026: vendedor usa a MESMA estrutura do master — NavItem
                      que vai DIRETO pra página do agente (/pedro, /marcos), sem
                      submenu expansível. As abas internas de cada página já
                      filtram por visibleFeatures, então o acesso continua
                      respeitado. Isso elimina a divergência (ex: "Performance"
                      que aparecia só no submenu do vendedor) — layout idêntico,
                      diferença só nos acessos liberados pelo master. */}
                  {showPedro && (
                    <NavItem collapsed={collapsed} item={{ title: 'Pedro SDR', url: '/pedro', icon: Bot }} />
                  )}
                  {showMarcosSeller && (
                    <NavItem collapsed={collapsed} item={{ title: 'Marcos CRM', url: '/marcos', icon: Users }} />
                  )}
                  {sellerExtraAgents.map(item => (
                    <NavItem key={item.url} item={item} collapsed={collapsed} />
                  ))}
                </NavGroup>
              );
            })()}

            {(() => {
              const sellerSysItems = allSellerSystemItems.filter(i => visibleFeatures[i.featureKey]);
              return sellerSysItems.length > 0 ? (
                <NavGroup label="Sistema" defaultOpen={false} collapsed={collapsed}>
                  {sellerSysItems.map(item => (
                    <NavItem key={item.url} item={item} collapsed={collapsed} />
                  ))}
                </NavGroup>
              ) : null;
            })()}
          </>
        ) : (
          /* ── MASTER: tudo agrupado em "Agentes" filtrado por plano ── */
          <>
            {/* ── Dashboard ── */}
            <NavGroup label="Painel" collapsed={collapsed}>
              <NavItem collapsed={collapsed} item={{ title: 'Tela inicial', url: '/tela-inicial', icon: Home }} />
              {/* [Unificado] item "Dashboard" removido — virou parte do Painel Geral. */}
              {/* Painel Geral — soma Pedro + Marcos. Master only. */}
              <NavItem collapsed={collapsed} item={{ title: 'Painel Geral', url: '/painel-geral', icon: BarChart3 }} />
              {/* Painel ao Vivo — do sistema (saiu do agente Pedro). */}
              <NavItem collapsed={collapsed} item={{ title: 'Painel ao Vivo', url: '/painel-ao-vivo', icon: MonitorPlay }} />
            </NavGroup>

            {/* ── Agentes (Pedro + Marcos + José + demais conforme plano) ── */}
            <NavGroup label="Agentes" collapsed={collapsed}>
              {/* Pedro — sempre (básico+) */}
              <NavItem collapsed={collapsed} item={{ title: 'Pedro SDR', url: '/pedro', icon: Bot }} />

              {/* Marcos — Pro+. Igual ao Pedro: clica e vai pra /marcos (página
                  individual já tem as 8 abas internas — Performance, CRM,
                  Formulários, Contatos, Disparo, Inbox, Instâncias, Automações).
                  Antes era NavMarcosExpandable com sub-itens duplicados no
                  sidebar, comportamento diferente do Pedro/José. */}
              {showMarcos && (
                <NavItem collapsed={collapsed} item={{ title: 'Marcos CRM', url: '/marcos', icon: Users }} />
              )}

              {/* José — Pro+ */}
              {showJose && (
                <NavItem collapsed={collapsed} item={{ title: 'José Tráfego Pago', url: '/jose', icon: Radar }} />
              )}

              {/* Enterprise (Pro Max) */}
              {showEnterprise && <>
                <NavItem collapsed={collapsed} item={{ title: 'Salomão Orquestrador', url: '/salomao', icon: Sparkles }} />
                <NavItem collapsed={collapsed} item={{ title: 'Paulo Copywriting', url: '/copywriter', icon: PenTool }} />
                <NavItem collapsed={collapsed} item={{ title: 'Maria Designer', url: '/creative-studio', icon: Palette }} />
                <NavItem collapsed={collapsed} item={{ title: 'Davi Social Mídia', url: '/davi', icon: Instagram }} />
                <NavItem collapsed={collapsed} item={{ title: 'João E-mail MKT', url: '/joao', icon: Mail }} />
                <NavItem collapsed={collapsed} item={{ title: 'Daniel Estrategista', url: '/daniel', icon: Brain }} />
              </>}
            </NavGroup>

            {/* ── Sistema ── */}
            <NavGroup label="Sistema" defaultOpen={false} collapsed={collapsed}>
              {systemItems.map(item => {
                // Fase 6.5f: badge dinâmico com contador de pendentes pra "Campos Dinâmicos"
                const isDynamicFields = item.url === '/configuracoes/campos-dinamicos';
                const itemWithBadge = isDynamicFields
                  ? { ...item, badge: dynamicFieldsPendingCount }
                  : item;
                return <NavItem key={item.url} item={itemWithBadge} collapsed={collapsed} />;
              })}
              {/* Auditoria de consumo de IA por cliente/agente (god-view). */}
              {isAdmin && (
                <NavItem collapsed={collapsed} item={{ title: 'Auditoria IA', url: '/admin/auditoria-ia', icon: Activity }} />
              )}
              {/* Painel de Administracao (donos): saude/qualidade dos agentes por cliente. */}
              {isAdmin && (
                <NavItem collapsed={collapsed} item={{ title: 'Administração', url: '/administracao', icon: ShieldCheck }} />
              )}
            </NavGroup>
          </>
        )}

      </SidebarContent>

      {/* ── Footer ── */}
      <SidebarFooter className={`border-t border-border/40 p-2 ${collapsed ? 'items-center' : ''}`}>
        {!collapsed && (
          <div className="px-1 pb-1">
            <TokenWidgetCompact />
          </div>
        )}
        <SidebarMenu>
          {/* Atalhos fixos: Configurações + Meu Perfil (sempre no rodapé) */}
          {(!isSeller || visibleFeatures?.sidebar_configuracoes) && (
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Configurações"
                onClick={() => navigate('/settings')}
                className="text-muted-foreground hover:text-foreground"
              >
                <Settings className="h-4 w-4" />
                {!collapsed && <span className="text-sm">Configurações</span>}
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Meu Perfil"
              onClick={() => navigate('/perfil')}
              className="text-muted-foreground hover:text-foreground"
            >
              <Users className="h-4 w-4" />
              {!collapsed && <span className="text-sm">Meu Perfil</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={isDarkMode ? 'Modo Claro' : 'Modo Escuro'}
              onClick={toggleDarkMode}
              className="text-muted-foreground hover:text-foreground"
            >
              {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {!collapsed && <span className="text-sm">{isDarkMode ? 'Modo Claro' : 'Modo Escuro'}</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Sair"
              onClick={handleLogout}
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
              {!collapsed && <span className="text-sm">Sair</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

    </Sidebar>
  );
}
