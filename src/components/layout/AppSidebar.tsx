import {
  Home,
  Brain,
  PenTool,
  Palette,
  Layers,
  BarChart3,
  Plug,
  GraduationCap,
  Settings,
  Sparkles,
  Moon,
  Sun,
  X,
  LogOut,
  MessageCircle,
  Contact,
  Send,
  Megaphone,
  Inbox,
  Zap,
  Smartphone,
  Bot,
  Activity,
  Radar,
  Kanban,
  Target,
  Users,
  Linkedin,
  Search,
  Instagram,
  Calendar,
  BookOpen,
  Video,
  ShoppingCart,
  CreditCard,
  Globe,
  Mail,
  Database,
  Webhook,
  LayoutDashboard,
  Eye,
  Filter,
  TrendingUp,
  PieChart,
} from 'lucide-react';
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

// 📊 Dashboard — Visão Geral
const dashboardItems = [
  { title: 'Visão Geral', url: '/dashboard', icon: LayoutDashboard },
  { title: 'Métricas', url: '/analytics', icon: TrendingUp },
  { title: 'Relatórios', url: '/reports', icon: PieChart },
];

// 👑 Agentes IA
const agentItems = [
  { title: '🏛️ Salomão — Orquestrador', url: '/agents/salomao', icon: Sparkles },
  { title: '📊 José — Tráfego Pago', url: '/agents/jose', icon: Radar },
  { title: '🎯 Marcos — Leads', url: '/agents/marcos', icon: Users },
  { title: '✍️ Paulo — Copywriter', url: '/agents/paulo', icon: PenTool },
  { title: '🎨 Maria — Design', url: '/agents/maria', icon: Palette },
  { title: '📱 Davi — Social Media', url: '/agents/davi', icon: Send },
  { title: '🔀 Lucas — Funil', url: '/agents/lucas', icon: Layers },
  { title: '📧 João — Email', url: '/agents/joao', icon: Megaphone },
  { title: '💬 Pedro — Atendimento', url: '/agents/pedro', icon: Bot },
  { title: '🧠 Daniel — Estratégia', url: '/agents/daniel', icon: Brain },
];

// 🛠️ Ferramentas
const toolItems = [
  { title: 'Estúdio Criativo', url: '/creative-studio', icon: Palette },
  { title: 'Inteligência Criativa', url: '/creative-intelligence', icon: Target },
  { title: 'Radar de Concorrentes', url: '/competitor-radar', icon: Radar },
  { title: 'Biblioteca Criativa', url: '/creative-studio?tab=biblioteca', icon: Eye },
];

// 📋 CRM
const crmItems = [
  { title: 'Flux CRM', url: '/crm', icon: Kanban },
  { title: 'Contatos', url: '/crm/contacts', icon: Contact },
];

// 📈 Plataformas de Ads
const platformItems = [
  { title: 'Google Ads', url: '/google-ads', icon: Search },
  { title: 'LinkedIn Ads', url: '/linkedin-ads', icon: Linkedin },
];

// 📱 Social Media
const socialItems = [
  { title: 'DAVI — Carrosséis', url: '/davi', icon: Instagram },
  { title: 'Calendário de Posts', url: '/davi?tab=calendario', icon: Calendar },
];

// 🔗 Integrações — TODAS
const integrationItems = [
  { title: 'Painel de Integrações', url: '/integrations', icon: Plug },
  { title: 'Meta Ads', url: '/integrations?tab=meta', icon: Globe },
  { title: 'Google Ads', url: '/integrations?tab=google', icon: Search },
  { title: 'Google Analytics', url: '/integrations?tab=ga4', icon: BarChart3 },
  { title: 'TikTok Ads', url: '/integrations?tab=tiktok', icon: Smartphone },
  { title: 'LinkedIn Ads', url: '/integrations?tab=linkedin', icon: Linkedin },
  { title: 'Zapier', url: '/integrations?tab=zapier', icon: Zap },
  { title: 'Hotmart', url: '/integrations?tab=hotmart', icon: ShoppingCart },
  { title: 'Stripe', url: '/integrations?tab=stripe', icon: CreditCard },
  { title: 'Mailchimp', url: '/integrations?tab=mailchimp', icon: Mail },
  { title: 'Webhook', url: '/integrations?tab=webhook', icon: Webhook },
  { title: 'Evolution API', url: '/integrations?tab=evolution', icon: MessageCircle },
  { title: 'Shopify', url: '/integrations?tab=shopify', icon: ShoppingCart },
  { title: 'RD Station', url: '/integrations?tab=rdstation', icon: Database },
];

// 💬 WhatsApp
const whatsappItems = [
  { title: 'Instâncias', url: '/whatsapp/instances', icon: Smartphone },
  { title: 'Inbox', url: '/whatsapp/inbox', icon: Inbox },
  { title: 'Disparo em Massa', url: '/whatsapp/broadcast', icon: Send },
  { title: 'Analytics', url: '/whatsapp/analytics', icon: BarChart3 },
  { title: 'Automações', url: '/whatsapp/automations', icon: Zap },
  { title: 'Agente IA', url: '/whatsapp/ai-agent', icon: Bot },
  { title: 'Extrator de Contatos', url: '/whatsapp/contacts', icon: Contact },
  { title: 'CAPI Tracking', url: '/whatsapp/capi', icon: Activity },
];

// 🎓 Tutoriais
const tutorialItems = [
  { title: 'Academia IA', url: '/academy', icon: GraduationCap },
  { title: 'Guias de Início', url: '/academy?tab=inicio', icon: BookOpen },
  { title: 'Vídeo Tutoriais', url: '/academy?tab=videos', icon: Video },
];

// ⚙️ Sistema
const systemItems = [
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
                      end={item.url === '/dashboard'}
                      className="relative text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground"
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
                      end={item.url === '/dashboard'}
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

  const groups: NavGroupConfig[] = [
    { label: '📊 Dashboard', items: dashboardItems, triggerIcon: LayoutDashboard },
    { label: '👑 Agentes IA', items: agentItems, triggerIcon: Sparkles, dataTour: 'sidebar-agents' },
    { label: '🛠️ Ferramentas', items: toolItems, triggerIcon: Brain },
    { label: '📋 CRM', items: crmItems, triggerIcon: Kanban },
    { label: '📈 Plataformas', items: platformItems, triggerIcon: BarChart3 },
    { label: '📱 Social Media', items: socialItems, triggerIcon: Instagram },
    { label: '🔗 Integrações', items: integrationItems, triggerIcon: Plug },
    { label: '💬 WhatsApp', items: whatsappItems, triggerIcon: MessageCircle },
    { label: '🎓 Tutoriais', items: tutorialItems, triggerIcon: GraduationCap },
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
              <LogosIALogo size="sm" showText />
              <span className="text-[10px] text-muted-foreground tracking-wider uppercase">Marketing & IA</span>
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
            dataTour={group.dataTour}
          />
        ))}
      </SidebarContent>

      <SidebarFooter className={`border-t border-border/50 p-2 ${collapsed ? 'items-center' : ''}`}>
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
