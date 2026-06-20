import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { MarketingHeader } from '@/components/marketing/MarketingHeader';
import { MarketingFooter } from '@/components/marketing/MarketingFooter';
import { LeadCaptureForm } from '@/components/marketing/LeadCaptureForm';
import { ArrowLeft, ArrowRight, CheckCircle2, Play } from 'lucide-react';

const DISPLAY = { fontFamily: 'var(--font-display)' } as const;

export type AgentFeature = { t: string; d: string };
export type ResponsibilityBlock = {
  titulo: string;
  resumo?: string;
  itens: AgentFeature[];
};
export type AgentDetailData = {
  origem: string;
  nome: string;
  cor: string;
  bg: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  h1: string;
  sub: string;
  // Vídeo do agente: ID do YouTube (sem URL completa). Null = placeholder "em breve".
  videoId?: string | null;
  videoLegenda?: string;
  pain: string[];
  painClose: string;
  responsabilidades: ResponsibilityBlock[];
  diferenciais?: AgentFeature[];
  promise: string;
  paraQuem: string;
  ctaLabel: string;
};

// Página de detalhe de um agente (Pedro/Marcos/José). Hero -> vídeo -> dor ->
// O que ele faz (blocos de responsabilidades) -> diferenciais -> promessa ->
// para quem é -> CTA. Reusa header/footer/marca da home.
export function AgentDetailPage({ data }: { data: AgentDetailData }) {
  const [leadOpen, setLeadOpen] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <MarketingHeader onCta={() => setLeadOpen(true)} />

      {/* Hero */}
      <section className="relative px-4 md:px-6 pt-10 pb-10 md:pt-16 md:pb-12 overflow-hidden">
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

      {/* Vídeo do agente */}
      <section className="px-4 md:px-6 pb-10 md:pb-14">
        <div className="max-w-3xl mx-auto">
          <div className="relative overflow-hidden rounded-2xl border-2" style={{ borderColor: `${data.cor}55`, boxShadow: '0 28px 80px -28px rgba(15, 38, 71, 0.45)' }}>
            <div className="aspect-video w-full">
              {data.videoId ? (
                <iframe
                  className="h-full w-full"
                  src={`https://www.youtube.com/embed/${data.videoId}`}
                  title={`Vídeo do ${data.nome}`}
                  frameBorder="0"
                  allow="accelerated-encoding; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                  loading="lazy"
                />
              ) : (
                <div
                  className="h-full w-full flex flex-col items-center justify-center text-center px-6"
                  style={{ background: 'linear-gradient(160deg, var(--brand-navy) 0%, var(--brand-navy-dark) 100%)' }}
                >
                  <div className="h-16 w-16 rounded-full flex items-center justify-center mb-4" style={{ background: `${data.cor}22`, border: `1px solid ${data.cor}55` }}>
                    <Play className="h-7 w-7" style={{ color: data.cor }} />
                  </div>
                  <p className="text-lg md:text-xl font-extrabold" style={{ color: 'var(--brand-cream)', ...DISPLAY }}>
                    Em breve: vídeo do {data.nome} explicando por dentro
                  </p>
                  <p className="text-xs md:text-sm mt-2 max-w-md" style={{ color: 'rgba(250, 248, 242, 0.65)' }}>
                    Aqui o {data.nome} vai mostrar, em poucos minutos, exatamente como ele trabalha pelo seu negócio.
                  </p>
                </div>
              )}
            </div>
          </div>
          {data.videoLegenda && (
            <p className="text-center text-xs text-muted-foreground italic mt-3">{data.videoLegenda}</p>
          )}
        </div>
      </section>

      {/* Dor */}
      <section className="px-4 md:px-6 py-10 md:py-12 bg-card/30 border-y border-border/40">
        <div className="max-w-3xl mx-auto space-y-3">
          {data.pain.map((p, i) => (
            <p key={i} className="text-base md:text-lg text-muted-foreground leading-relaxed">{p}</p>
          ))}
          <p className="text-lg md:text-xl font-bold pt-2" style={{ color: data.cor }}>{data.painClose}</p>
        </div>
      </section>

      {/* O que ele faz (blocos de responsabilidades) */}
      <section className="px-4 md:px-6 py-14 md:py-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3" style={DISPLAY}>O que o {data.nome} faz pelo seu negócio</h2>
            <p className="text-muted-foreground">Tudo organizado em frentes de trabalho — cada uma operando 24/7 sem você precisar pedir.</p>
          </div>

          <div className="space-y-10">
            {data.responsabilidades.map((bloco, idx) => (
              <div key={bloco.titulo}>
                <div className="flex items-center gap-3 mb-4">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold" style={{ background: data.bg, color: data.cor }}>
                    {idx + 1}
                  </span>
                  <h3 className="text-xl md:text-2xl font-bold" style={DISPLAY}>{bloco.titulo}</h3>
                </div>
                {bloco.resumo && (
                  <p className="text-sm md:text-base text-muted-foreground leading-relaxed mb-4 ml-11">{bloco.resumo}</p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-0 md:ml-11">
                  {bloco.itens.map((item) => (
                    <div key={item.t} className="flex items-start gap-3 rounded-xl border border-foreground/10 bg-card p-4">
                      <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" style={{ color: data.cor }} />
                      <div>
                        <p className="font-semibold text-foreground text-sm md:text-base" style={DISPLAY}>{item.t}</p>
                        <p className="text-xs md:text-sm text-muted-foreground leading-relaxed mt-0.5">{item.d}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Diferenciais (opcional) */}
      {data.diferenciais && data.diferenciais.length > 0 && (
        <section className="px-4 md:px-6 py-12 md:py-16 bg-card/30 border-y border-border/40">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold text-center mb-8" style={DISPLAY}>
              Por que o <span style={{ color: data.cor }}>{data.nome}</span> é diferente
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.diferenciais.map((d) => (
                <div key={d.t} className="rounded-xl border border-foreground/10 bg-card p-5">
                  <p className="font-bold text-foreground mb-1" style={DISPLAY}>{d.t}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{d.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

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
          <p className="mt-4 text-xs" style={{ color: 'rgba(250, 248, 242, 0.75)' }}>⚡ Atendimento humano de verdade — falo com você no WhatsApp.</p>
        </div>
      </section>

      <MarketingFooter />
      <LeadCaptureForm open={leadOpen} onOpenChange={setLeadOpen} origem={data.origem} />
    </div>
  );
}
