import { useState } from 'react';
import {
  Home,
  LayoutDashboard,
  Brain,
  PenTool,
  Palette,
  BarChart3,
  Plug,
  Settings,
  Sparkles,
  Moon,
  Sun,
  X,
  LogOut,
  Contact,
  Send,
  Inbox,
  Zap,
  Smartphone,
  Bot,
  Activity,
  Radar,
  Target,
  Users,
  Instagram,
  CreditCard,
  FileCode2,
  ChevronDown,
  Layers,
  MessageCircle,
} from 'lucide-react';
import { TokenWidgetCompact } from '@/components/subscription/TokenWidget';
import { LogosIAIcon, LogosIALogo } from '@/components/brand/LogosIALogo';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { useAuth } from '@/hooks/useAuth';
import { useCampaignNotifications } from '@/hooks/useCampaignNotifications';
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

// ─── Tipos ────────────────────────────────────────────────────────────────────

type NavItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  subItems?: Omit<NavItem, 'subItems'>[];
};

type NavGroupConfig = {
  label: string;
  items: NavItem[];
  triggerIcon: React.ComponentType<{ className?: string }>;
  dataTour?: string;
};

// ─── Dados de navegação ───────────────────────────────────────────────────────

// 🏠 Início
const dashboardItems: NavItem[] = [
  { title: 'Dashboard',        url: '/dashboard',   icon: LayoutDashboard },
  { title: 'Métricas',         url: '/metrics',     icon: BarChart3 },
  { title: 'Performance 360°', url: '/performance', icon: Activity },
];

// 🤖 Agentes IA — Marcos tem sub-itens do WhatsApp integrados
const agentItems: NavItem[] = [
  { title: 'Salomão — Orquestrador',     url: '/salomao',        icon: Sparkles },
  { title: 'Daniel — Estrategista',      url: '/daniel',         icon: Brain },
  { title: 'Paulo — Copywriter',         url: '/copywriter',     icon: PenTool },
  { title: 'Maria — Design',             url: '/creative-studio',icon: Palette },
  { title: 'Davi — Social Media',        url: '/davi',           icon: Instagram },
  { title: 'João — Email Marketing',     url: '/joao',           icon: Send },
  { title: 'José — Tráfego Pago',        url: '/jose',           icon: Radar },
  { title: 'Lucas — Funil de Vendas',    url: '/lucas',          icon: Layers },
  {
    title: 'Marcos — Leads & WhatsApp',
    url: '/leads',
    icon: Users,
    // WhatsApp integrado diretamente como sub-itens do Marcos
    subItems: [
      { title: 'Instâncias',         url: '/whatsapp/instances',   icon: Smartphone },
      { title: 'Inbox',              url: '/whatsapp/inbox',        icon: Inbox },
      { title: 'Disparo em Massa',   url: '/whatsapp/broadcast',    icon: Send },
      { title: 'Analytics',          url: '/whatsapp/analytics',    icon: BarChart3 },
      { title: 'Automações',         url: '/whatsapp/automations',  icon: Zap },
      { title: 'Agente Pedro',       url: '/whatsapp/ai-agent',     icon: Bot },  // IA de atendimento
      { title: 'Extrator de Leads',  url: '/whatsapp/contacts',     icon: Contact },
      { title: 'CAPI Tracking',      url: '/whatsapp/capi',         icon: Activity },
    ],
  },
];

// ⚙️ Configurações — Ferramentas + Integrações + Sistema consolidados
const configItems: NavItem[] = [
  { title: 'Inteligência Criativa',   url: '/creative-intelligence', icon: Target },
  { title: 'Radar de Concorrentes',   url: '/competitor-radar',      icon: Radar },
  { title: 'Gerador de Prompt IA',    url: '/gerador-prompt',        icon: FileCode2 },
  { title: 'Integrações',             url: '/integrations',          icon: Plug },
  { title: 'Meu Plano & Tokens',      url: '/meu-plano',             icon: CreditCard },
  { title: 'Configurações',           url: '/settings',              icon: Settings },
];

// ─── NavItemRenderer — renderiza item simples ou com sub-itens ───────────────

function NavItemRenderer({
  item,
  collapsed,
}: {
  item: NavItem;
  collapsed?: boolean;
}) {
  const [subOpen, setSubOpen] = useState(false);

  // Item SEM sub-itens — renderização simples
  if (!item.subItems || item.subItems.length === 0) {
    return (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton asChild tooltip={item.title}>
          <NavLink
            to={item.url}
            end={item.url === '/'}
            className="relative text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground"
            activeClassName="bg-primary/10 text-primary font-medium"
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="flex-1 truncate">{item.title}</span>}
            {(item.badge || 0) > 0 && (
              <Badge className="ml-auto h-5 min-w-5 rounded-full px-1.5 text-[10px] gradient-primary border-0 flex items-center justify-center text-primary-foreground">
                {item.badge}
              </Badge>
            )}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  // Item COM sub-itens — colapsável (ex: Marcos + WhatsApp)
  if (collapsed) {
    // Sidebar colapsada: mostra apenas o ícone pai como trigger dos sub-itens
    return (
      <Collapsible open={subOpen} onOpenChange={setSubOpen}>
        <SidebarMenuItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton
              tooltip={`${item.title} (WhatsApp)`}
              className="relative text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {/* Badge verde indicando que o WhatsApp está integrado */}
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-emerald-500 border border-background" />
            </SidebarMenuButton>
          </CollapsibleTrigger>
        </SidebarMenuItem>
        <CollapsibleContent>
          {item.subItems.map((sub) => (
            <SidebarMenuItem key={sub.title}>
              <SidebarMenuButton asChild tooltip={sub.title}>
                <NavLink
                  to={sub.url}
                  className="text-muted-foreground/80 hover:bg-accent hover:text-accent-foreground transition-colors"
                  activeClassName="bg-primary/10 text-primary font-medium"
                >
                  <sub.icon className="h-4 w-4 shrink-0" />
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // Sidebar expandida: item pai + sub-itens com indentação e ícone toggle
  return (
    <Collapsible open={subOpen} onOpenChange={setSubOpen}>
      {/* Item pai (Marcos) */}
      <SidebarMenuItem>
        <div className="flex w-full items-center gap-1">
          {/* Link para a página do Marcos */}
          <SidebarMenuButton asChild className="flex-1" tooltip={item.title}>
            <NavLink
              to={item.url}
              className="relative text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground"
              activeClassName="bg-primary/10 text-primary font-medium"
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">{item.title}</span>
              {/* Badge WhatsApp */}
              <span className="mr-1 flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">
                <MessageCircle className="h-2.5 w-2.5" />
                WA
              </span>
            </NavLink>
          </SidebarMenuButton>
          {/* Botão toggle dos sub-itens */}
          <CollapsibleTrigger asChild>
            <button
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-accent hover:text-accent-foreground transition-colors"
              title={subOpen ? 'Recolher WhatsApp' : 'Expandir WhatsApp'}
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${subOpen ? 'rotate-180' : ''}`} />
            </button>
          </CollapsibleTrigger>
        </div>
      </SidebarMenuItem>

      {/* Sub-itens WhatsApp — com linha guia vertical e indentação */}
      <CollapsibleContent>
        <div className="relative ml-3 mt-0.5 pb-1">
          {/* Linha guia vertical */}
          <div className="absolute left-0 top-0 h-full w-px bg-emerald-500/20" />
          <SidebarMenu className="pl-3">
            {item.subItems.map((sub) => (
              <SidebarMenuItem key={sub.title}>
                <SidebarMenuButton asChild tooltip={sub.title} className="h-8">
                  <NavLink
                    to={sub.url}
                    className="text-xs text-muted-foreground/70 hover:bg-accent hover:text-accent-foreground transition-colors"
                    activeClassName="bg-emerald-500/10 text-emerald-400 font-medium"
                  >
                    <sub.icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1 truncate">{sub.title}</span>
                    {/* Destaque especial para o Agente Pedro */}
                    {sub.title === 'Agente Pedro' && (
                      <span className="rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-blue-400 border border-blue-500/20">
                        IA
                      </span>
                    )}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── NavGroup — renderiza um grupo de navegação ───────────────────────────────

function NavGroup({
  label, items, collapsed, isOpen, onToggle, triggerIcon: TriggerIcon, dataTour,
}: {
  label: string;
  items: NavItem[];
  collapsed?: boolean;
  isOpen?: boolean;
  onToggle?: () => void;
  triggerIcon: React.ComponentType<{ className?: string }>;
  dataTour?: string;
}) {
  const groupBadge = items.reduce((sum, item) => sum + (item.badge || 0), 0);

  // ── Sidebar COLAPSADA (só ícones) ──
  if (collapsed) {
    return (
      <Collapsible open={isOpen} onOpenChange={onToggle} {...(dataTour ? { 'data-tour': dataTour } : {})}>
        <div className={`rounded-md transition-colors duration-200 ${isOpen ? 'bg-muted/40' : ''}`}>
          <SidebarMenu>
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton
                  tooltip={label}
                  className="relative text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <TriggerIcon className="h-4 w-4" />
                  {groupBadge > 0 && (
                    <Badge className="absolute -right-1 -top-1 h-4 w-4 rounded-full p-0 text-[9px] gradient-primary border-0 flex items-center justify-center">
                      {groupBadge}
                    </Badge>
                  )}
                </SidebarMenuButton>
              </CollapsibleTrigger>
            </SidebarMenuItem>
            <CollapsibleContent>
              {items.map((item) => (
                <NavItemRenderer key={item.title} item={item} collapsed={collapsed} />
              ))}
            </CollapsibleContent>
          </SidebarMenu>
        </div>
      </Collapsible>
    );
  }

  // ── Sidebar EXPANDIDA ──
  return (
    <Collapsible open={isOpen} onOpenChange={onToggle} {...(dataTour ? { 'data-tour': dataTour } : {})}>
      <SidebarGroup>
        <CollapsibleTrigger asChild>
          <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground/70 cursor-pointer hover:text-muted-foreground transition-colors">
            {label}
            {groupBadge > 0 && (
              <Badge className="ml-2 h-4 min-w-4 rounded-full px-1 text-[9px] gradient-primary border-0 flex items-center justify-center text-primary-foreground">
                {groupBadge}
              </Badge>
            )}
          </SidebarGroupLabel>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <NavItemRenderer key={item.title} item={item} collapsed={collapsed} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

// ─── AppSidebar ───────────────────────────────────────────────────────────────

export function AppSidebar() {
  const { isDarkMode, toggleDarkMode, openSidebarGroups, toggleSidebarGroup } = useAppStore();
  const { signOut } = useAuth();
  const { unreadCount } = useCampaignNotifications();
  const navigate = useNavigate();
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === 'collapsed';

  const handleLogout = async () => {
    await signOut();
    navigate('/auth');
  };

  const dashboardWithBadges = dashboardItems.map((item) => ({
    ...item,
    badge: item.url === '/' ? unreadCount : 0,
  }));

  // ── 3 grupos no lugar de 6 ──────────────────────────────────────────────────
  const groups: NavGroupConfig[] = [
    {
      label: '🏠 Início',
      items: dashboardWithBadges,
      triggerIcon: Home,
    },
    {
      label: '🤖 Agentes IA',
      items: agentItems,
      triggerIcon: Bot,
      dataTour: 'sidebar-agents',
    },
    {
      label: '⚙️ Configurações',
      items: configItems,
      triggerIcon: Settings,
    },
  ];

  return (
    <Sidebar collapsible="icon" className="border-r border-border/50">
      {/* ── Header ── */}
      <SidebarHeader className="border-b border-border/50 p-4">
        {collapsed ? (
          <div className="flex justify-center">
            <button
              onClick={toggleSidebar}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl hover:bg-accent/50 transition-colors"
            >
              <LogosIAIcon size={30} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <LogosIALogo size="sm" showText className="" />
              <span className="text-[10px] text-muted-foreground tracking-wider uppercase">
                Marketing & IA
              </span>
            </div>
            <button
              onClick={toggleSidebar}
              className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent transition-colors"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        )}
      </SidebarHeader>

      {/* ── Navegação ── */}
      <SidebarContent className={collapsed ? 'px-0 items-center pt-4' : 'px-2'}>
        {groups.map((group) => (
          <NavGroup
            key={group.label}
            label={group.label}
            items={group.items}
            collapsed={collapsed}
            isOpen={openSidebarGroups.includes(group.label)}
            onToggle={() => toggleSidebarGroup(group.label)}
            triggerIcon={group.triggerIcon}
            dataTour={group.dataTour}
          />
        ))}
      </SidebarContent>

      {/* ── Footer ── */}
      <SidebarFooter className={`border-t border-border/50 p-2 ${collapsed ? 'items-center' : ''}`}>
        {!collapsed && (
          <div className="px-1 pb-1">
            <TokenWidgetCompact />
          </div>
        )}
        <SidebarMenu>
          <SidebarMenuItem data-tour="dark-mode">
            <SidebarMenuButton
              tooltip={isDarkMode ? 'Modo Claro' : 'Modo Escuro'}
              onClick={toggleDarkMode}
            >
              {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span>{isDarkMode ? 'Modo Claro' : 'Modo Escuro'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Sair"
              onClick={handleLogout}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
              <span>Sair</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
