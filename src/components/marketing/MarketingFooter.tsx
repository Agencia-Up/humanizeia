import { Link } from 'react-router-dom';
import { LogosIALogo } from '@/components/brand/LogosIALogo';

// Footer público compartilhado (home + páginas de detalhe).
export function MarketingFooter() {
  return (
    <footer className="px-4 md:px-6 pt-12 pb-6" style={{ background: 'var(--brand-navy-dark)', color: 'var(--brand-cream)' }}>
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-10 pb-10">
          <div className="col-span-2 md:col-span-1">
            <div className="mb-3"><LogosIALogo size="md" variant="dark" /></div>
            <p className="text-xs leading-relaxed" style={{ color: 'rgba(250, 248, 242, 0.65)' }}>
              Atendimento, CRM e tráfego IA pra quem vive de WhatsApp.
            </p>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--brand-gold)' }}>Agentes</h4>
            <ul className="space-y-2.5 text-sm">
              <li><Link to="/pedro" className="opacity-80 hover:opacity-100 transition-opacity">Pedro — Atendimento</Link></li>
              <li><Link to="/marcos" className="opacity-80 hover:opacity-100 transition-opacity">Marcos — CRM</Link></li>
              <li><Link to="/jose" className="opacity-80 hover:opacity-100 transition-opacity">José — Tráfego</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--brand-gold)' }}>Empresa</h4>
            <ul className="space-y-2.5 text-sm">
              <li><Link to="/" className="opacity-80 hover:opacity-100 transition-opacity">Início</Link></li>
              <li><a href="/sobre.html" className="opacity-80 hover:opacity-100 transition-opacity">Sobre</a></li>
              <li><a href="mailto:suporte@logosiabrasil.com" className="opacity-80 hover:opacity-100 transition-opacity">Contato</a></li>
              <li><Link to="/auth" className="opacity-80 hover:opacity-100 transition-opacity">Login</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--brand-gold)' }}>Legal</h4>
            <ul className="space-y-2.5 text-sm">
              <li><a href="/privacy-policy.html" className="opacity-80 hover:opacity-100 transition-opacity">Privacidade</a></li>
              <li><a href="/terms-of-service.html" className="opacity-80 hover:opacity-100 transition-opacity">Termos de Uso</a></li>
              <li><span className="opacity-60 text-xs">LGPD: dados tratados conforme lei brasileira</span></li>
            </ul>
          </div>
        </div>

        <div className="pt-6" style={{ borderTop: '1px solid rgba(250, 248, 242, 0.10)' }}>
          <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
            <p className="text-xs leading-relaxed" style={{ color: 'rgba(250, 248, 242, 0.80)' }}>
              <span className="font-semibold" style={{ color: 'var(--brand-cream)' }}>Agencia Up Business LTDA</span>
              <span className="opacity-75">&nbsp;·&nbsp;CNPJ 45.660.833/0001-17&nbsp;·&nbsp;Taubaté/SP</span>
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs sm:justify-end" style={{ color: 'rgba(250, 248, 242, 0.60)' }}>
              <span>© {new Date().getFullYear()} LOGOS|IA</span>
              <span className="opacity-40">·</span>
              <span>Feito no Brasil 🇧🇷</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
