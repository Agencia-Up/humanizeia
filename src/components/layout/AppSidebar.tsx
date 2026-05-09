import {
  LayoutDashboard,
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
} from 'lucide-react';
import { TokenWidgetCompact } from '@/components/subscription/TokenWidget';
import { LogosIAIcon, LogosIALogo } from '@/components/brand/LogosIALogo';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { useAuth } from '@/hooks/useAuth';
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
import { useSellerProfile } from '@/hooks/useSellerProfile';

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

// ── Marcos — sub-itens Leads & WhatsApp ──────────────────────────────────────
const marcosSubItems = [
  { title: 'CRM',             url: '/crm',               icon: Kanban },
  { title: 'Formulários',     url: '/crm/formularios',   icon: ClipboardList },
  { title: 'Contatos',        url: '/whatsapp/contacts', icon: Users },
  { title: 'Disparo em Massa',url: '/whatsapp/broadcast',icon: Send },
  { title: 'Inbox',           url: '/whatsapp/inbox',    icon: Inbox },
  { title: 'Instâncias',      url: '/whatsapp/instances',icon: Smartphone },
  { title: 'Automações',      url: '/whatsapp/automations',icon: Zap },
];

// ── Sistema ───────────────────────────────────────────────────────────────────
const systemItems = [
  { title: 'Treinamento',      url: '/treinamento',   icon: GraduationCap },
  { title: 'Meu Plano',        url: '/meu-plano',     icon: CreditCard },
  { title: 'Integrações',      url: '/integrations',  icon: Plug },
  { title: 'Configurações',    url: '/settings',      icon: Settings },
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
          end={item.url === '/dashboard'}
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
  const { isSeller, loading: sellerLoading } = useSellerProfile(user?.id);

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
              <LogosIAIcon size={28} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <LogosIALogo size="sm" showText />
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
          /* ── SELLER: apenas Marcos ── */
          <NavGroup label="Marcos" collapsed={collapsed}>
            <NavMarcosExpandable collapsed={collapsed} />
          </NavGroup>
        ) : (
          /* ── MASTER: visão completa ── */
          <>
            {/* ── Dashboard ── */}
            <NavGroup label="Painel" collapsed={collapsed}>
              <NavItem collapsed={collapsed} item={{ title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard }} />
            </NavGroup>

            {/* ── Marcos — Captação de Leads & WhatsApp ── */}
            <NavGroup label="Marcos CRM" collapsed={collapsed}>
              <NavMarcosExpandable collapsed={collapsed} />
            </NavGroup>

            {/* ── Sistema ── */}
            <NavGroup label="Sistema" defaultOpen={false} collapsed={collapsed}>
              {systemItems.map(item => (
                <NavItem key={item.url} item={item} collapsed={collapsed} />
              ))}
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
