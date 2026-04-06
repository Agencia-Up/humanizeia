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
  MessageCircle,
  Contact,
  Send,
  Inbox,
  Zap,
  Smartphone,
  Activity,
  Radar,
  Users,
  Instagram,
  CreditCard,
  Kanban,
  GraduationCap,
  FileText,
  Bot,
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

// 🏠 Dashboard
const dashboardItems = [
  { title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard },
  { title: 'Métricas', url: '/metrics', icon: BarChart3 },
  { title: 'Performance 360°', url: '/performance', icon: Activity },
];

// 🤖 Agentes IA — Pedro incluído
const agentItems = [
  { title: 'Salomão — Orquestrador', url: '/salomao', icon: Sparkles },
  { title: 'Daniel — Estrategista', url: '/daniel', icon: Brain },
  { title: 'Paulo — Copywriter', url: '/copywriter', icon: PenTool },
  { title: 'Maria — Design', url: '/creative-studio', icon: Palette },
  { title: 'Davi — Social Media', url: '/davi', icon: Instagram },
  { title: 'João — Email Mkt', url: '/joao', icon: Send },
  { title: 'José — Tráfego Pago', url: '/jose', icon: Radar },
  { title: 'Marcos — Leads & CRM', url: '/leads', icon: Users },
  { title: 'Pedro — Atendimento IA', url: '/whatsapp/ai-agent', icon: Bot },
];

// 💬 WhatsApp & CRM — sem duplicata de /leads, Pedro no grupo Agentes
const whatsappItems = [
  { title: 'CRM — Pipeline', url: '/crm', icon: Kanban },
  { title: 'Instâncias', url: '/whatsapp/instances', icon: Smartphone },
  { title: 'Inbox', url: '/whatsapp/inbox', icon: Inbox },
  { title: 'Disparo em Massa', url: '/whatsapp/broadcast', icon: Send },
  { title: 'Analytics', url: '/whatsapp/analytics', icon: BarChart3 },
  { title: 'Automações', url: '/whatsapp/automations', icon: Zap },
  { title: 'Extrator de Contatos', url: '/whatsapp/contacts', icon: Contact },
  { title: 'CAPI Tracking', url: '/whatsapp/capi', icon: Activity },
];

// 🔗 Integrações
const integrationItems = [
  { title: 'Integrações', url: '/integrations', icon: Plug },
];

// ⚙️ Sistema — Academia e Tutoriais adicionados
const systemItems = [
  { title: 'Meu Plano & Tokens', url: '/meu-plano', icon: CreditCard },
  { title: 'Academia IA', url: '/academy', icon: GraduationCap },
  { title: 'Tutoriais', url: '/tutorials', icon: FileText },
  { title: 'Configurações', url: '/settings', icon: Settings },
];

type NavItem = { title: string; url: string; icon: React.ComponentType<{ className?: string }>; badge?: number };
type NavGroupConfig = { label: string; items: NavItem[]; triggerIcon: React.ComponentType<{ className?: string }>; dataTour?: string };

function NavGroup({
  label, items, collapsed, isOpen, onToggle, triggerIcon: TriggerIcon, dataTour
}: {
  label: string; items: NavItem[]; collapsed?: boolean; isOpen?: boolean; onToggle?: () => void; triggerIcon: React.ComponentType<{ className?: string }>; dataTour?: string;
}) {
  const groupBadge = items.reduce((sum, item) => sum + (item.badge || 0), 0);

  if (collapsed) {
    return (
      <Collapsible open={isOpen} onOpenChange={onToggle} {...(dataTour ? { 'data-tour': dataTour } : {})}>
        <div className={`rounded-md transition-colors duration-200 ${isOpen ? 'bg-muted/40' : ''}`}>
          <SidebarMenu>
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton tooltip={label} className="relative text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
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
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <NavLink
                      to={item.url}
                      end={item.url === '/'}
                      className="relative text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground"
                      activeClassName="bg-primary/10 text-primary font-medium"
                    >
                      <item.icon className="h-4 w-4" />
                      {(item.badge || 0) > 0 && (
                        <Badge className="absolute -right-1 -top-1 h-4 w-4 rounded-full p-0 text-[9px] gradient-primary border-0 flex items-center justify-center">
                          {item.badge}
                        </Badge>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </CollapsibleContent>
          </SidebarMenu>
        </div>
      </Collapsible>
    );
  }

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
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <NavLink
                      to={item.url}
                      end={item.url === '/'}
                      className="text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground"
                      activeClassName="bg-primary/10 text-primary font-medium"
                    >
                      <item.icon className="h-4 w-4" />
                      <span className="flex-1">{item.title}</span>
                      {(item.badge || 0) > 0 && (
                        <Badge className="ml-auto h-5 min-w-5 rounded-full px-1.5 text-[10px] gradient-primary border-0 flex items-center justify-center text-primary-foreground">
                          {item.badge}
                        </Badge>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

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

  const groups: NavGroupConfig[] = [
    { label: '🏠 Dashboard', items: dashboardWithBadges, triggerIcon: Home },
    { label: '🤖 Agentes IA', items: agentItems, triggerIcon: Bot, dataTour: 'sidebar-agents' },
    { label: '💬 WhatsApp & CRM', items: whatsappItems, triggerIcon: MessageCircle },
    { label: '🔗 Integrações', items: integrationItems, triggerIcon: Plug },
    { label: '⚙️ Sistema', items: systemItems, triggerIcon: Settings },
  ];

  return (
    <Sidebar collapsible="icon" className="border-r border-border/50">
      <SidebarHeader className="border-b border-border/50 p-4">
        {collapsed ? (
          <div className="flex justify-center">
            <button onClick={toggleSidebar} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl hover:bg-accent/50 transition-colors">
              <LogosIAIcon size={30} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <LogosIALogo size="sm" showText className="" />
              <span className="text-[10px] text-muted-foreground tracking-wider uppercase">Marketing & IA</span>
            </div>
            <button onClick={toggleSidebar} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent transition-colors">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        )}
      </SidebarHeader>

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

      <SidebarFooter className={`border-t border-border/50 p-2 ${collapsed ? 'items-center' : ''}`}>
        {!collapsed && (
          <div className="px-1 pb-1">
            <TokenWidgetCompact />
          </div>
        )}
        <SidebarMenu>
          <SidebarMenuItem data-tour="dark-mode">
            <SidebarMenuButton tooltip={isDarkMode ? 'Modo Claro' : 'Modo Escuro'} onClick={toggleDarkMode}>
              {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span>{isDarkMode ? 'Modo Claro' : 'Modo Escuro'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Sair" onClick={handleLogout} className="text-destructive hover:text-destructive hover:bg-destructive/10">
              <LogOut className="h-4 w-4" />
              <span>Sair</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
