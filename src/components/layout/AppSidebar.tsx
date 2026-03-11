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
  GripVertical,
  LogOut,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { useAuth } from '@/hooks/useAuth';
import { NavLink } from '@/components/NavLink';
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
  { title: 'Agente MIDAS', url: '/midas', icon: Bot },
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
];

const learnItems = [
  { title: 'Academia IA', url: '/academy', icon: GraduationCap },
  { title: 'Configurações', url: '/settings', icon: Settings },
];

type NavItem = { title: string; url: string; icon: React.ComponentType<{ className?: string }> };

function NavGroup({ 
  label, items, collapsed, isOpen, onToggle, triggerIcon: TriggerIcon 
}: { 
  label: string; items: NavItem[]; collapsed?: boolean; isOpen?: boolean; onToggle?: () => void; triggerIcon: React.ComponentType<{ className?: string }>;
}) {
  if (collapsed) {
    return (
      <Collapsible open={isOpen} onOpenChange={onToggle}>
        <div className={`rounded-md transition-colors duration-200 ${isOpen ? 'bg-muted/40' : ''}`}>
          <SidebarMenu>
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton tooltip={label} className="text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
                  <TriggerIcon className="h-4 w-4" />
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
                      className="text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground"
                      activeClassName="bg-primary/10 text-primary font-medium"
                    >
                      <item.icon className="h-4 w-4" />
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
                  <span>{item.title}</span>
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
  const navigate = useNavigate();
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === 'collapsed';

  const handleLogout = async () => {
    await signOut();
    navigate('/auth');
  };

  const groups = [
    { label: 'Principal', items: mainNavItems, triggerIcon: Sparkles },
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
              <Menu className="h-5 w-5 text-muted-foreground" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl gradient-primary">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold gradient-text">TrafficAI</span>
                <span className="text-xs text-muted-foreground">Pro Platform</span>
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
