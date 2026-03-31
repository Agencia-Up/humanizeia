import { useState, useRef, useCallback } from 'react';
import html2canvas from 'html2canvas';
import { ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react';
import { CarouselSlide } from '@/hooks/useSocialMedia';
import { Button } from '@/components/ui/button';

// ── Template definitions ──────────────────────────────────────────────────────
export const CAROUSEL_TEMPLATES = [
  {
    id: 'dark_pro',
    name: 'Dark Pro',
    emoji: '🖤',
    bg: '#0A0A0A',
    bgGradient: 'linear-gradient(135deg, #0A0A0A 0%, #1A1A2E 100%)',
    accent: '#7C3AED',
    accentGlow: 'rgba(124,58,237,0.3)',
    text: '#FFFFFF',
    sub: '#A1A1AA',
    muted: '#3F3F46',
    fontWeight: '800',
    borderStyle: '2px solid rgba(124,58,237,0.4)',
  },
  {
    id: 'gold',
    name: 'Gold Elite',
    emoji: '✨',
    bg: '#0D0900',
    bgGradient: 'linear-gradient(135deg, #0D0900 0%, #1A1200 100%)',
    accent: '#D4A017',
    accentGlow: 'rgba(212,160,23,0.3)',
    text: '#FFFFFF',
    sub: '#C9A84C',
    muted: '#3A2D00',
    fontWeight: '800',
    borderStyle: '2px solid rgba(212,160,23,0.4)',
  },
  {
    id: 'editorial',
    name: 'Editorial',
    emoji: '📰',
    bg: '#0D1B2A',
    bgGradient: 'linear-gradient(160deg, #0D1B2A 0%, #1B2838 100%)',
    accent: '#00B4D8',
    accentGlow: 'rgba(0,180,216,0.25)',
    text: '#E8F4FD',
    sub: '#90CAE4',
    muted: '#1E3A4C',
    fontWeight: '700',
    borderStyle: '1px solid rgba(0,180,216,0.3)',
  },
  {
    id: 'neon',
    name: 'Neon',
    emoji: '⚡',
    bg: '#050510',
    bgGradient: 'linear-gradient(135deg, #050510 0%, #0D0D2B 100%)',
    accent: '#00FF88',
    accentGlow: 'rgba(0,255,136,0.25)',
    text: '#FFFFFF',
    sub: '#7EFFC5',
    muted: '#1A1A3E',
    fontWeight: '900',
    borderStyle: '1px solid rgba(0,255,136,0.4)',
  },
  {
    id: 'clean_light',
    name: 'Clean Light',
    emoji: '☀️',
    bg: '#FAFAFA',
    bgGradient: 'linear-gradient(135deg, #FFFFFF 0%, #F0F4FF 100%)',
    accent: '#6366F1',
    accentGlow: 'rgba(99,102,241,0.15)',
    text: '#111827',
    sub: '#6B7280',
    muted: '#E5E7EB',
    fontWeight: '800',
    borderStyle: '2px solid rgba(99,102,241,0.2)',
  },
  {
    id: 'rose',
    name: 'Rose Gold',
    emoji: '🌹',
    bg: '#120008',
    bgGradient: 'linear-gradient(135deg, #120008 0%, #2D0015 100%)',
    accent: '#FB7185',
    accentGlow: 'rgba(251,113,133,0.3)',
    text: '#FFF0F3',
    sub: '#FCA5B4',
    muted: '#3D001A',
    fontWeight: '800',
    borderStyle: '1px solid rgba(251,113,133,0.4)',
  },
] as const;

export type TemplateId = typeof CAROUSEL_TEMPLATES[number]['id'];

// ── Accent word highlight ─────────────────────────────────────────────────────
function HighlightHeadline({ text, accentWord, color }: { text: string; accentWord?: string; color: string }) {
  if (!accentWord || !text.toLowerCase().includes(accentWord.toLowerCase())) {
    return <span>{text}</span>;
  }
  const regex = new RegExp(`(${accentWord})`, 'i');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((p, i) =>
        regex.test(p)
          ? <span key={i} style={{ color }}>{p}</span>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

// ── Single Slide Page ─────────────────────────────────────────────────────────
function SlidePageInner({ slide, tpl, brandName, total }: {
  slide: CarouselSlide;
  tpl: typeof CAROUSEL_TEMPLATES[number];
  brandName: string;
  total: number;
}) {
  const isCover = slide.type === 'cover' || slide.order === 1;
  const isCta   = slide.type === 'cta'   || slide.order === total;
  const isLight  = tpl.id === 'clean_light';

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: tpl.bgGradient,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}
    >
      {/* Top accent bar */}
      <div style={{ height: 4, background: `linear-gradient(90deg, ${tpl.accent}, transparent)`, width: '100%', flexShrink: 0 }} />

      {/* Decorative background number (subtle) */}
      {!isCta && (
        <div style={{
          position: 'absolute', right: -10, top: '50%', transform: 'translateY(-50%)',
          fontSize: 180, fontWeight: 900, color: tpl.accentGlow,
          lineHeight: 1, userSelect: 'none', zIndex: 0, pointerEvents: 'none',
        }}>
          {String(slide.order).padStart(2, '0')}
        </div>
      )}

      {/* Brand tag top-left */}
      <div style={{
        position: 'absolute', top: 14, left: 16, zIndex: 2,
        fontSize: 10, fontWeight: 700, letterSpacing: '0.15em',
        color: tpl.accent, textTransform: 'uppercase',
        background: isLight ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.05)',
        padding: '3px 8px', borderRadius: 4,
      }}>
        {brandName}
      </div>

      {/* Slide counter top-right */}
      <div style={{
        position: 'absolute', top: 14, right: 16, zIndex: 2,
        fontSize: 10, fontWeight: 700, color: tpl.sub,
        fontFeatureSettings: '"tnum"',
      }}>
        {slide.order}/{total}
      </div>

      {/* Main content */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        justifyContent: isCover ? 'center' : 'flex-start',
        padding: isCover ? '48px 24px 32px' : '52px 24px 24px',
        zIndex: 1, gap: 10,
      }}>

        {/* Sub headline / label */}
        {slide.sub_headline && (
          <div style={{
            fontSize: isCover ? 12 : 11,
            fontWeight: 600,
            color: tpl.accent,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 2,
          }}>
            {slide.sub_headline}
          </div>
        )}

        {/* Main headline */}
        <div style={{
          fontSize: isCover ? 26 : 22,
          fontWeight: tpl.fontWeight as any,
          color: tpl.text,
          lineHeight: 1.15,
          letterSpacing: '-0.02em',
        }}>
          <HighlightHeadline
            text={slide.headline}
            accentWord={slide.accent_word}
            color={tpl.accent}
          />
        </div>

        {/* Accent line */}
        <div style={{ width: 40, height: 3, background: tpl.accent, borderRadius: 2, marginTop: 2, marginBottom: 4 }} />

        {/* Body text */}
        {slide.body && (
          <div style={{
            fontSize: 13,
            color: tpl.sub,
            lineHeight: 1.55,
            maxWidth: '92%',
          }}>
            {slide.body}
          </div>
        )}

        {/* Bullet list */}
        {slide.bullets && slide.bullets.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            {slide.bullets.map((b, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: tpl.accent, marginTop: 5, flexShrink: 0,
                  boxShadow: `0 0 6px ${tpl.accentGlow}`,
                }} />
                <span style={{ fontSize: 12, color: tpl.text, lineHeight: 1.4 }}>{b}</span>
              </div>
            ))}
          </div>
        )}

        {/* CTA button (only on cta slide) */}
        {isCta && slide.cta && (
          <div style={{
            marginTop: 12,
            padding: '10px 20px',
            background: tpl.accent,
            color: isLight ? '#fff' : tpl.bg,
            borderRadius: 8,
            fontWeight: 800,
            fontSize: 13,
            display: 'inline-block',
            width: 'fit-content',
            boxShadow: `0 4px 20px ${tpl.accentGlow}`,
            letterSpacing: '0.01em',
          }}>
            {slide.cta}
          </div>
        )}

        {/* Swipe hint (not on last) */}
        {!isCta && (
          <div style={{
            position: 'absolute', bottom: 20, right: 20,
            fontSize: 10, color: tpl.muted, display: 'flex', alignItems: 'center', gap: 3,
          }}>
            Arraste → 
          </div>
        )}
      </div>

      {/* Bottom accent */}
      <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${tpl.accent}40)`, flexShrink: 0 }} />
    </div>
  );
}

// ── Main component exported ───────────────────────────────────────────────────
interface CarouselPageViewerProps {
  slides: CarouselSlide[];
  templateId: TemplateId;
  onTemplateChange: (id: TemplateId) => void;
  brandName?: string;
  caption?: string;
}

export function CarouselPageViewer({
  slides, templateId, onTemplateChange, brandName = 'Minha Marca', caption
}: CarouselPageViewerProps) {
  const [current, setCurrent] = useState(0);
  const [exporting, setExporting] = useState(false);
  const slideRef = useRef<HTMLDivElement>(null);
  const tpl = CAROUSEL_TEMPLATES.find(t => t.id === templateId) ?? CAROUSEL_TEMPLATES[0];
  const slide = slides[current];
  if (!slide) return null;

  const handleExport = useCallback(async () => {
    if (!slideRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(slideRef.current, {
        scale: 3,
        useCORS: true,
        backgroundColor: null,
        logging: false,
      });
      const link = document.createElement('a');
      link.download = `slide-${String(slide.order).padStart(2, '0')}-${tpl.name.toLowerCase().replace(/\s/g, '-')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (e) {
      console.error('Export failed:', e);
    } finally {
      setExporting(false);
    }
  }, [slide, tpl]);

  // 4:5 proportional size — display at 300px wide = 375px tall
  const DISPLAY_W = 300;
  const DISPLAY_H = Math.round(DISPLAY_W * (1350 / 1080));

  return (
    <div className="flex flex-col gap-3 items-center">

      {/* Main slide preview */}
      <div style={{ position: 'relative', width: DISPLAY_W, height: DISPLAY_H }}>
        <div
          ref={slideRef}
          style={{
            width: DISPLAY_W,
            height: DISPLAY_H,
            borderRadius: 12,
            overflow: 'hidden',
            border: tpl.borderStyle,
            boxShadow: `0 8px 40px ${tpl.accentGlow}, 0 2px 8px rgba(0,0,0,0.4)`,
            transition: 'box-shadow 0.3s',
          }}
        >
          <SlidePageInner slide={slide} tpl={tpl} brandName={brandName} total={slides.length} />
        </div>

        {/* Nav arrows */}
        {current > 0 && (
          <button
            onClick={() => setCurrent(p => p - 1)}
            style={{
              position: 'absolute', left: -14, top: '50%', transform: 'translateY(-50%)',
              width: 28, height: 28, borderRadius: '50%',
              background: tpl.accent, border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 0 12px ${tpl.accentGlow}`,
            }}
          >
            <ChevronLeft style={{ width: 16, height: 16, color: '#fff' }} />
          </button>
        )}
        {current < slides.length - 1 && (
          <button
            onClick={() => setCurrent(p => p + 1)}
            style={{
              position: 'absolute', right: -14, top: '50%', transform: 'translateY(-50%)',
              width: 28, height: 28, borderRadius: '50%',
              background: tpl.accent, border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 0 12px ${tpl.accentGlow}`,
            }}
          >
            <ChevronRight style={{ width: 16, height: 16, color: '#fff' }} />
          </button>
        )}
      </div>

      {/* Thumbnail strip */}
      <div style={{
        display: 'flex', gap: 5, overflowX: 'auto',
        maxWidth: DISPLAY_W + 28, paddingBottom: 4,
      }}>
        {slides.map((s, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            style={{
              flexShrink: 0,
              width: 44, height: 55,
              borderRadius: 6,
              border: i === current ? `2px solid ${tpl.accent}` : '2px solid transparent',
              overflow: 'hidden',
              cursor: 'pointer',
              opacity: i === current ? 1 : 0.5,
              transition: 'all 0.2s',
              background: tpl.bg,
              position: 'relative',
            }}
          >
            {/* Mini preview content */}
            <div style={{ transform: 'scale(0.25)', transformOrigin: 'top left', width: '400%', height: '400%', pointerEvents: 'none' }}>
              <div style={{ width: DISPLAY_W * 4, height: DISPLAY_H * 4, background: tpl.bgGradient, padding: 16 }}>
                <div style={{ fontSize: 36, fontWeight: 900, color: tpl.text, lineHeight: 1.1 }}>{s.headline}</div>
              </div>
            </div>
            {/* Slide number overlay */}
            <div style={{
              position: 'absolute', bottom: 2, right: 3,
              fontSize: 8, fontWeight: 700, color: tpl.accent,
            }}>{i + 1}</div>
          </button>
        ))}
      </div>

      {/* Template picker */}
      <div className="flex items-center gap-1.5 justify-center">
        {CAROUSEL_TEMPLATES.map(t => (
          <button
            key={t.id}
            onClick={() => onTemplateChange(t.id as TemplateId)}
            title={t.name}
            style={{
              width: 20, height: 20, borderRadius: '50%',
              background: t.accent,
              border: t.id === templateId ? '3px solid white' : '2px solid transparent',
              cursor: 'pointer',
              transform: t.id === templateId ? 'scale(1.25)' : 'scale(1)',
              transition: 'all 0.15s',
              boxShadow: t.id === templateId ? `0 0 8px ${t.accentGlow}` : 'none',
            }}
          />
        ))}
      </div>

      {/* Export button */}
      <Button
        size="sm"
        variant="outline"
        onClick={handleExport}
        disabled={exporting}
        className="gap-1.5 text-xs h-8"
        style={{ borderColor: tpl.accent + '60', color: tpl.accent }}
      >
        {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
        {exporting ? 'Exportando...' : `Baixar Slide ${slide.order}`}
      </Button>
    </div>
  );
}
