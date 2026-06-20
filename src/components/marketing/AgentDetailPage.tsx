import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { MarketingHeader } from '@/components/marketing/MarketingHeader';
import { MarketingFooter } from '@/components/marketing/MarketingFooter';
import { LeadCaptureForm } from '@/components/marketing/LeadCaptureForm';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';

const DISPLAY = { fontFamily: 'var(--font-display)' } as const;

export type AgentFeature = { t: string; d: string };
export type AgentDetailData = {
  origem: string;
  nome: string;
  cor: string;
  bg: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  h1: string;
  sub: string;
  pain: string[];
  painClose: string;
  features: AgentFeature[];
  promise: string;
  paraQuem: string;
  ctaLabel: string;
};

// Página de detalhe de um agente (Pedro/Marcos/José). Mesmo header/footer e marca
// da home; fecha com o CTA primário (formulário de lead).
export function AgentDetailPage({ data }: { data: AgentDetailData }) {
  const [leadOpen, setLeadOpen] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <MarketingHeader onCta={() => setLeadOpen(true)} />

      {/* Hero */}
      <section className="relative px-4 md:px-6 pt-10 pb-10 md:pt-16 md:pb-14 overflow-hidden">
        <div className="absolute -top-10 -right-16 w-[22rem] h-[22rem] rounded-full blur-3xl pointer-events-none opacity-20" style={{ background: data.cor }} />
        <div className="relative max-w-3xl mx-auto">
          <Link to="/#agentes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
            <ArrowLeft className="h-4 w-4" /> Voltar aos agentes
          </Link>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl mb-5" style={{ background: data.bg }}>
            <data.Icon className="h-7 w-7" style={{ color: data.cor }} />
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold leading-[1.12] mb-4" style={DISPLAY}>{data.h1}</h1>
          <p className="text-base md:text-lg text-muted-foreground leading-relaxed">{data.sub}</p>
        </div>
      </section>

      {/* Dor */}
      <section className="px-4 md:px-6 py-10 bg-card/30 border-y border-border/40">
        <div className="max-w-3xl mx-auto space-y-3">
          {data.pain.map((p, i) => (
            <p key={i} className="text-base md:text-lg text-muted-foreground leading-relaxed">{p}</p>
          ))}
          <p className="text-lg md:text-xl font-bold pt-2" style={{ color: data.cor }}>{data.painClose}</p>
        </div>
      </section>

      {/* Features */}
      <section className="px-4 md:px-6 py-14 md:py-20">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-5">
          {data.features.map((f) => (
            <div key={f.t} className="flex items-start gap-3 rounded-2xl border border-foreground/10 bg-card p-5">
              <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" style={{ color: data.cor }} />
              <div>
                <p className="font-semibold text-foreground" style={DISPLAY}>{f.t}</p>
                <p className="text-sm text-muted-foreground leading-relaxed mt-0.5">{f.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Promessa */}
      <section className="px-4 md:px-6 py-10">
        <div className="max-w-3xl mx-auto rounded-2xl border p-6 md:p-8 text-center" style={{ borderColor: `${data.cor}40`, background: data.bg }}>
          <p className="text-lg md:text-2xl font-bold leading-snug" style={DISPLAY}>{data.promise}</p>
        </div>
      </section>

      {/* Para quem é */}
      <section className="px-4 md:px-6 pb-6">
        <div className="max-w-3xl mx-auto">
          <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Para quem é:</span> {data.paraQuem}
          </p>
        </div>
      </section>

      {/* CTA final */}
      <section className="px-4 md:px-6 py-14 md:py-20 mt-6" style={{ background: 'var(--brand-navy)', color: 'var(--brand-cream)' }}>
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-6" style={DISPLAY}>Coloque a Logos IA pra trabalhar hoje.</h2>
          <Button size="lg" onClick={() => setLeadOpen(true)} className="px-7 text-base" style={{ background: 'var(--brand-gold)', color: 'var(--brand-navy-dark)' }}>
            {data.ctaLabel} <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <p className="mt-4 text-xs" style={{ color: 'rgba(250, 248, 242, 0.75)' }}>⚡ No ar em 5 minutos · Sem fidelidade</p>
        </div>
      </section>

      <MarketingFooter />
      <LeadCaptureForm open={leadOpen} onOpenChange={setLeadOpen} origem={data.origem} />
    </div>
  );
}
