import {
  Home, 
  PenTool, 
  Palette,
  Rocket,
  DollarSign, 
  BarChart3, 
  Settings2, 
  FlaskConical, 
  FolderOpen, 
  FileText, 
  GraduationCap, 
  Settings,
  Sparkles,
  Bot,
  Moon,
  Sun,
  Menu,
  X,
  ChevronDown,
  Layers,
  Zap,
  Cog,
  Library,
  Plug,
  GripVertical,
  LogOut,
} from 'lucide-react';
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
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';

const mainNavItems = [
  { title: 'Painel', url: '/', icon: Home },
  { title: 'Agente Apollo', url: '/midas', icon: Bot },
  { title: 'Copywriter IA', url: '/copywriter', icon: PenTool },
  { title: 'Estúdio Criativo', url: '/creative-studio', icon: Palette },
];

const optimizationItems = [
  { title: 'Otimizador de Campanhas', url: '/optimizer', icon: Rocket },
  { title: 'Alocador de Verba', url: '/budget', icon: DollarSign },
  { title: 'Análises', url: '/analytics', icon: BarChart3 },
];

const automationItems = [
  { title: 'Regras Automáticas', url: '/rules', icon: Settings2 },
  { title: 'Laboratório A/B', url: '/ab-testing', icon: FlaskConical },
];

const libraryItems = [
  { title: 'Biblioteca Criativa', url: '/library', icon: FolderOpen },
  { title: 'Relatórios', url: '/reports', icon: FileText },
  { title: 'Pixel Unificado', url: '/pixel', icon: Layers },
  { title: 'Integrações', url: '/integrations', icon: Plug },
];

const learnItems = [
  { title: 'Academia IA', url: '/academy', icon: GraduationCap },
  { title: 'Configurações', url: '/settings', icon: Settings },
];

type NavItem = { title: string; url: string; icon: React.ComponentType<{ className?: string }>; badge?: number };

function NavGroup({ 
  label, items, collapsed, isOpen, onToggle, triggerIcon: TriggerIcon 
}: { 
  label: string; items: NavItem[]; collapsed?: boolean; isOpen?: boolean; onToggle?: () => void; triggerIcon: React.ComponentType<{ className?: string }>;
}) {
  const groupBadge = items.reduce((sum, item) => sum + (item.badge || 0), 0);

  if (collapsed) {
    return (
      <Collapsible open={isOpen} onOpenChange={onToggle}>
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
    <SidebarGroup>
      <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground/70">
        {label}
      </SidebarGroupLabel>
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
    </SidebarGroup>
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

  // Inject badges into nav items
  const mainWithBadges = mainNavItems.map((item) => ({
    ...item,
    badge: item.url === '/' ? unreadCount : 0,
  }));

  const groups = [
    { label: 'Principal', items: mainWithBadges, triggerIcon: Sparkles },
    { label: 'Otimização', items: optimizationItems, triggerIcon: Zap },
    { label: 'Automação', items: automationItems, triggerIcon: Cog },
    { label: 'Biblioteca', items: libraryItems, triggerIcon: Library },
    { label: 'Mais', items: learnItems, triggerIcon: Layers },
  ];

  return (
    <Sidebar collapsible="icon" className="border-r border-border/50">
      <SidebarHeader className="border-b border-border/50 p-4">
        {collapsed ? (
          <div className="flex justify-center">
            <button onClick={toggleSidebar} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl hover:bg-accent transition-colors">
              <img src="/humanizeai-logo.png" alt="HumanizeAI" className="h-8 w-8 object-contain" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/humanizeai-logo.png" alt="HumanizeAI" className="h-10 w-10 shrink-0 rounded-xl object-contain" />
              <div className="flex flex-col">
                <span className="text-lg font-bold gradient-text">HumanizeAI</span>
                <span className="text-xs text-muted-foreground">Platform</span>
              </div>
            </div>
            <button onClick={toggleSidebar} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent transition-colors">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className={collapsed ? "px-0 items-center pt-4" : "px-2"}>
        {groups.map((group) => (
          <NavGroup
            key={group.label}
            label={group.label}
            items={group.items}
            collapsed={collapsed}
            isOpen={openSidebarGroups.includes(group.label)}
            onToggle={() => toggleSidebarGroup(group.label)}
            triggerIcon={group.triggerIcon}
          />
        ))}
      </SidebarContent>

      <SidebarFooter className={`border-t border-border/50 p-2 ${collapsed ? 'items-center' : ''}`}>
        <SidebarMenu>
          <SidebarMenuItem>
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
