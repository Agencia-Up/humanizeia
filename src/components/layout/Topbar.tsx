import { Bell, Search, Moon, Sun, Menu, Sparkles, LogOut, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useNavigate } from 'react-router-dom';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/store/appStore';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useAuth } from '@/hooks/useAuth';
import { useCampaignNotifications } from '@/hooks/useCampaignNotifications';
import { ApolloAlertBell } from '@/components/apollo/ApolloAlertBell';

export function Topbar() {
  const navigate = useNavigate();
  const { isDarkMode, toggleDarkMode, user } = useAppStore();
  const { signOut, user: authUser } = useAuth();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useCampaignNotifications();

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border/50 bg-background/80 px-4 backdrop-blur-lg lg:px-6">
      <div className="flex items-center gap-4">
        <SidebarTrigger className="lg:hidden"><Menu className="h-5 w-5" /></SidebarTrigger>
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar campanhas, criativos, relatórios..." className="w-80 bg-muted/50 pl-10 focus:bg-background" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={() => navigate('/midas')} className="flex gradient-primary text-primary-foreground gap-2 font-semibold" size="sm">
          <Sparkles className="h-4 w-4" /><span className="hidden md:inline">APOLLO</span>
        </Button>
        <Button variant="ghost" size="icon" onClick={toggleDarkMode} className="text-muted-foreground hover:text-foreground">
          {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>
        <ApolloAlertBell />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <Badge className="absolute -right-1 -top-1 h-5 w-5 rounded-full p-0 text-xs gradient-primary border-0">{unreadCount}</Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              Notificações
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">{unreadCount} novas</Badge>
                {unreadCount > 0 && (
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={markAllAsRead}>
                    <CheckCheck className="mr-1 h-3 w-3" />
                    Ler todas
                  </Button>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications?.length ? notifications.slice(0, 10).map((n: any) => (
              <DropdownMenuItem 
                key={n.id} 
                className="flex flex-col items-start gap-1 p-3 cursor-pointer"
                onClick={() => !n.is_read && markAsRead(n.id)}
              >
                <div className="flex items-center gap-2">
                  {!n.is_read && <div className="h-2 w-2 rounded-full bg-primary" />}
                  <span className="font-medium">{n.title}</span>
                </div>
                <span className="text-sm text-muted-foreground">{n.message}</span>
                <span className="text-xs text-muted-foreground">{formatTimeAgo(new Date(n.created_at))}</span>
              </DropdownMenuItem>
            )) : (
              <DropdownMenuItem className="text-center text-muted-foreground py-4">Nenhuma notificação</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2">
              <Avatar className="h-8 w-8">
                <AvatarImage src={user?.avatar} alt={user?.name} />
                <AvatarFallback className="gradient-primary text-white">{user?.name?.charAt(0) || 'U'}</AvatarFallback>
              </Avatar>
              <div className="hidden flex-col items-start text-sm md:flex">
                <span className="font-medium">{user?.name}</span>
                <span className="text-xs text-muted-foreground">{user?.plan}</span>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Minha Conta</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Perfil</DropdownMenuItem>
            <DropdownMenuItem>Configurações</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" /> Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
  if (diffInMinutes < 60) return `${diffInMinutes} min atrás`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h atrás`;
  return `${Math.floor(diffInHours / 24)}d atrás`;
}
