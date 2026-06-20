import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { LogosIALogo } from '@/components/brand/LogosIALogo';
import { useAppStore } from '@/store/appStore';
import { Moon, Sun, Menu, X } from 'lucide-react';

// Header público compartilhado (home + páginas de detalhe). O CTA primário abre o
// formulário de lead (onCta). navItems é opcional (a home passa as âncoras; as
// páginas de detalhe ficam sem nav, só logo + Entrar + CTA).
export function MarketingHeader({
  onCta, navItems = [],
}: { onCta: () => void; navItems?: { href: string; label: string }[] }) {
  const { isDarkMode, toggleDarkMode } = useAppStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur-md">
      <div className="px-4 md:px-6 py-3.5 flex items-center justify-between gap-4">
        <Link to="/" className="flex items-center shrink-0 hover:opacity-90 transition-opacity">
          <LogosIALogo size="sm" variant={isDarkMode ? 'dark' : 'light'} />
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
          {navItems.map(it => (
            <a key={it.href} href={it.href} className="hover:text-foreground transition-colors">{it.label}</a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-2 shrink-0">
          <Button variant="ghost" size="icon" onClick={toggleDarkMode} className="text-muted-foreground hover:text-foreground" title={isDarkMode ? 'Modo claro' : 'Modo escuro'}>
            {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" asChild className="text-muted-foreground hover:text-foreground"><Link to="/auth">Entrar</Link></Button>
          <Button onClick={onCta} className="bg-primary text-primary-foreground hover:bg-primary/90">Quero testar agora</Button>
        </div>

        <div className="flex md:hidden items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" onClick={toggleDarkMode} className="text-muted-foreground hover:text-foreground h-9 w-9">
            {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(v => !v)} className="text-muted-foreground hover:text-foreground h-9 w-9" aria-label="Menu">
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {mobileMenuOpen && (
        <nav className="md:hidden border-t border-border/40 bg-background/98 px-4 py-3 space-y-0.5">
          {navItems.map(it => (
            <a key={it.href} href={it.href} className="block px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-card/60 rounded-lg transition-colors" onClick={() => setMobileMenuOpen(false)}>{it.label}</a>
          ))}
          <div className="pt-3 mt-2 border-t border-border/30 flex flex-col gap-2">
            <Button variant="outline" asChild className="w-full"><Link to="/auth" onClick={() => setMobileMenuOpen(false)}>Entrar</Link></Button>
            <Button onClick={() => { setMobileMenuOpen(false); onCta(); }} className="w-full bg-primary text-primary-foreground hover:bg-primary/90">Quero testar agora →</Button>
          </div>
        </nav>
      )}
    </header>
  );
}
