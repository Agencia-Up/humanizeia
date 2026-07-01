import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { LogosIALogo } from '@/components/brand/LogosIALogo';
import { useAppStore } from '@/store/appStore';
import { Moon, Sun, Menu, X } from 'lucide-react';

// Header publico compartilhado. O destino do CTA e definido pela pagina.
export function MarketingHeader({
  onCta, navItems = [], ctaLabel = 'Quero testar agora',
}: { onCta: () => void; navItems?: { href: string; label: string }[]; ctaLabel?: string }) {
  const { isDarkMode, toggleDarkMode } = useAppStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 md:px-6">
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
          <Button onClick={onCta} className="bg-primary text-primary-foreground hover:bg-primary/90">{ctaLabel}</Button>
        </div>

        <div className="flex md:hidden items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" onClick={toggleDarkMode} className="text-muted-foreground hover:text-foreground h-9 w-9">
            {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(v => !v)}
            className="h-10 w-10 text-muted-foreground hover:text-foreground"
            aria-label={mobileMenuOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="fixed inset-x-0 bottom-0 top-[68px] z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 w-full bg-background/55 backdrop-blur-sm"
            aria-label="Fechar menu"
            onClick={() => setMobileMenuOpen(false)}
          />
          <nav className="relative mx-3 overflow-hidden rounded-2xl border border-border/60 bg-background shadow-2xl">
            <div className="space-y-1 p-3">
              {navItems.map(it => (
                <a
                  key={it.href}
                  href={it.href}
                  className="flex min-h-12 items-center rounded-xl px-4 text-base font-semibold text-foreground transition-colors hover:bg-card/70"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {it.label}
                </a>
              ))}
            </div>
            <div className="flex flex-col gap-2 border-t border-border/40 bg-card/30 p-3">
              <Button variant="outline" asChild className="h-11 w-full">
                <Link to="/auth" onClick={() => setMobileMenuOpen(false)}>Entrar</Link>
              </Button>
              <Button
                onClick={() => { setMobileMenuOpen(false); onCta(); }}
                className="h-11 w-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {ctaLabel}
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
