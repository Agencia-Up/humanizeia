import { Bell, Search, Moon, Sun, Menu, LogOut, User as UserIcon, Settings } from 'lucide-react';
import { TokenWidget } from '@/components/subscription/TokenWidget';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useNavigate } from 'react-router-dom';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAppStore } from '@/store/appStore';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useAuth } from '@/hooks/useAuth';

export function Topbar() {
  const navigate = useNavigate();
  const { isDarkMode, toggleDarkMode } = useAppStore();
  const { user, profile, signOut } = useAuth();

  const displayName = profile?.full_name
    || user?.user_metadata?.full_name
    || user?.email?.split('@')[0]
    || 'Usuario';

  const avatarUrl = profile?.avatar_url || user?.user_metadata?.avatar_url || '';
  const initials = (displayName || 'U').charAt(0).toUpperCase();

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  return (
    <header className="logos-topbar shrink-0 sticky top-0 z-40 flex h-14 w-full items-center justify-between border-b border-border/60 bg-background/95 px-3 backdrop-blur-xl sm:h-16 sm:px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        <SidebarTrigger className="lg:hidden"><Menu className="h-5 w-5" /></SidebarTrigger>
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar campanhas, criativos, relatorios..." className="w-80 rounded-xl border-border/70 bg-white/80 pl-10 shadow-sm focus:bg-background dark:bg-muted/50" />
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
        <div className="hidden sm:block">
          <TokenWidget />
        </div>
        <Button variant="ghost" size="icon" onClick={toggleDarkMode} className="h-9 w-9 text-muted-foreground hover:text-foreground">
          {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        <Button variant="ghost" size="icon" className="hidden h-9 w-9 text-muted-foreground hover:text-foreground sm:inline-flex">
          <Bell className="h-5 w-5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex min-w-0 items-center gap-2 px-1.5 sm:px-2">
              <Avatar className="h-8 w-8">
                <AvatarImage src={avatarUrl} alt={displayName} />
                <AvatarFallback className="gradient-primary text-white">{initials}</AvatarFallback>
              </Avatar>
              <div className="hidden flex-col items-start text-sm md:flex">
                <span className="font-medium">{displayName}</span>
                <span className="text-xs text-muted-foreground">{user?.email}</span>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Minha Conta</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/perfil')}>
              <UserIcon className="mr-2 h-4 w-4" /> Perfil
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <Settings className="mr-2 h-4 w-4" /> Configurações
            </DropdownMenuItem>
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
