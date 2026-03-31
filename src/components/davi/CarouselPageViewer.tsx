import React, { useState, useRef, useCallback, useEffect, Component, ErrorInfo, ReactNode } from 'react';
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
    bgPattern: 'radial-gradient(circle at 10% 20%, rgba(124,58,237,0.15) 0%, transparent 50%), radial-gradient(circle at 90% 80%, rgba(124,58,237,0.15) 0%, transparent 50%)',
    bgSize: '100% 100%',
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
    bgGradient: '#0D0900',
    bgPattern: 'linear-gradient(45deg, rgba(212,160,23,0.03) 25%, transparent 25%, transparent 50%, rgba(212,160,23,0.03) 50%, rgba(212,160,23,0.03) 75%, transparent 75%, transparent)',
    bgSize: '24px 24px',
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
    bgPattern: 'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
    bgSize: '20px 20px',
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
    bgGradient: '#050510',
    bgPattern: 'radial-gradient(circle at 50% -20%, rgba(0,255,136,0.25) 0%, transparent 60%), repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,136,0.03) 2px, rgba(0,255,136,0.03) 4px)',
    bgSize: '100% 100%',
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
    bgGradient: '#FFFFFF',
    bgPattern: 'radial-gradient(rgba(99,102,241,0.15) 1.5px, transparent 1.5px)',
    bgSize: '16px 16px',
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
    bgGradient: '#120008',
    bgPattern: 'radial-gradient(ellipse at center, rgba(251,113,133,0.15) 0%, transparent 70%), linear-gradient(135deg, rgba(255,255,255,0.03) 25%, transparent 25%)',
    bgSize: '100% 100%',
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
  if (!text || typeof text !== 'string') return null;
  if (!accentWord || typeof accentWord !== 'string' || !text.toLowerCase().includes(accentWord.toLowerCase())) {
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

const POLLINATIONS_CACHE = new Map<string, string>();

// ── Single Slide Page ─────────────────────────────────────────────────────────
function SlidePageInner({ slide, tpl, brandName, total }: {
  slide: CarouselSlide;
  tpl: typeof CAROUSEL_TEMPLATES[number];
  brandName: string;
  total: number;
}) {
  const isCover = slide.type === 'cover' || slide.order === 1;
  const isCta   = slide.type === 'cta'   || slide.order === total;
  
  // Motor Fotográfico Pollinations.ai (Free/No-Key)
  const visualPrompt = encodeURIComponent(`${slide.visual_cue || slide.headline || 'creative photography'}, highly detailed, cinematic photography, realistic, 4k resolution, professional, masterpiece`);
  const seed = (slide.headline?.length || 10) * slide.order * 42;
  const bgImageUrlRaw = `https://image.pollinations.ai/prompt/${visualPrompt}?width=1080&height=1350&nologo=true&seed=${seed}`;
  
  // Resgata o link local direto da CPU/Memória (ObjectURL) que o Preloader fritou!
  const bgImageUrl = POLLINATIONS_CACHE.get(bgImageUrlRaw) || bgImageUrlRaw;

  // Para fundos fotográficos, forçamos o texto para branco puro para brilhar sob a máscara escura
  const textColor = '#ffffff';
  const subColor = 'rgba(255,255,255,0.85)';
  const isLight = false;

  // Garantia Rítmica de Layouts: Força a variação caso a IA envie tudo 'left' devagar
  let layout = slide.layout || 'left';
  if ((layout as string) === 'left' || (layout as string) === 'default') {
    if (isCover) layout = 'centered';
    else if (isCta) layout = 'centered';
    else {
      // Ritmo Moderno Apple:
      const cadence: Array<'minimal' | 'centered' | 'left'> = ['minimal', 'centered', 'left'];
      layout = cadence[(slide.order - 2 + cadence.length) % cadence.length];
    }
  }

  const renderLayoutContent = () => {
    switch (layout) {
      case 'centered':
        return (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '40px 24px', zIndex: 1, gap: 12 }}>
            {typeof slide.sub_headline === 'string' && slide.sub_headline.trim() && (
              <div style={{ fontSize: 11, fontWeight: 700, color: tpl.accent, letterSpacing: '0.1em', textTransform: 'uppercase', textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
                {slide.sub_headline}
              </div>
            )}
            <div style={{ fontSize: isCover ? 32 : 28, fontWeight: 900, color: textColor, lineHeight: 1.15, textShadow: '0 4px 20px rgba(0,0,0,0.6)' }}>
              <HighlightHeadline text={slide.headline} accentWord={slide.accent_word} color={tpl.accent} />
            </div>
            {typeof slide.body === 'string' && slide.body.trim() && (
              <div style={{ fontSize: 13, color: subColor, lineHeight: 1.5, marginTop: 8, maxWidth: '90%', textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
                {slide.body}
              </div>
            )}
            {Array.isArray(slide.bullets) && slide.bullets.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, alignItems: 'center' }}>
                {slide.bullets.map((b, i) => (
                  <div key={i} style={{ fontSize: 12, color: textColor, background: tpl.accent + '30', backdropFilter: 'blur(8px)', padding: '6px 14px', borderRadius: 12, border: `1px solid ${tpl.accent}50`, textShadow: '0 1px 5px rgba(0,0,0,0.5)' }}>
                    {typeof b === 'string' ? b : ''}
                  </div>
                ))}
              </div>
            )}
            {isCta && typeof slide.cta === 'string' && slide.cta.trim() && (
              <div style={{ marginTop: 24, padding: '14px 28px', background: tpl.accent, color: tpl.bg, borderRadius: 30, fontWeight: 900, fontSize: 15, boxShadow: `0 8px 32px ${tpl.accentGlow}` }}>
                {slide.cta}
              </div>
            )}
          </div>
        );

      case 'minimal':
        return (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 1 }}>
            <div style={{ 
              background: 'rgba(0,0,0,0.5)', 
              backdropFilter: 'blur(16px)', 
              border: `1px solid ${tpl.accent}50`, 
              borderRadius: 20, 
              padding: 28, 
              display: 'flex', 
              flexDirection: 'column', 
              gap: 12, 
              width: '100%', 
              boxShadow: `0 20px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)` 
            }}>
              {typeof slide.sub_headline === 'string' && slide.sub_headline.trim() && <div style={{ fontSize: 10, fontWeight: 800, color: tpl.accent, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{slide.sub_headline}</div>}
              <div style={{ fontSize: isCover ? 26 : 22, fontWeight: 900, color: textColor, lineHeight: 1.2 }}>
                <HighlightHeadline text={slide.headline} accentWord={slide.accent_word} color={tpl.accent} />
              </div>
              <div style={{ height: 3, background: tpl.accent, width: 40, borderRadius: 2 }} />
              {typeof slide.body === 'string' && slide.body.trim() && <div style={{ fontSize: 14, color: subColor, lineHeight: 1.5 }}>{slide.body}</div>}
              {Array.isArray(slide.bullets) && slide.bullets.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
                  {slide.bullets.map((b, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ color: tpl.accent, fontSize: 14 }}>✦</span>
                      <span style={{ fontSize: 13, color: textColor, fontWeight: 500 }}>{typeof b === 'string' ? b : ''}</span>
                    </div>
                  ))}
                </div>
              )}
              {isCta && typeof slide.cta === 'string' && slide.cta.trim() && (
                <div style={{ marginTop: 12, padding: '12px', background: textColor, color: '#000', borderRadius: 10, fontWeight: 900, fontSize: 13, textAlign: 'center' }}>
                  {slide.cta}
                </div>
              )}
            </div>
          </div>
        );

      case 'left':
      default:
        return (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            justifyContent: 'flex-end',
            padding: '40px 24px 40px',
            zIndex: 1, gap: 10,
          }}>
            {typeof slide.sub_headline === 'string' && slide.sub_headline.trim() && (
              <div style={{ fontSize: 12, fontWeight: 800, color: tpl.accent, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2, textShadow: '0 2px 10px rgba(0,0,0,0.8)' }}>
                {slide.sub_headline}
              </div>
            )}
            <div style={{ fontSize: isCover ? 30 : 26, fontWeight: 900, color: textColor, lineHeight: 1.15, letterSpacing: '-0.02em', textShadow: '0 4px 20px rgba(0,0,0,0.8)' }}>
              <HighlightHeadline text={slide.headline} accentWord={slide.accent_word} color={tpl.accent} />
            </div>
            <div style={{ width: 40, height: 4, background: tpl.accent, borderRadius: 2, marginTop: 4, marginBottom: 4, boxShadow: `0 0 10px ${tpl.accentGlow}` }} />
            {typeof slide.body === 'string' && slide.body.trim() && (
              <div style={{ fontSize: 14, color: subColor, lineHeight: 1.55, maxWidth: '95%', textShadow: '0 2px 10px rgba(0,0,0,0.8)' }}>
                {slide.body}
              </div>
            )}
            {Array.isArray(slide.bullets) && slide.bullets.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                {slide.bullets.map((b, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: tpl.accent, marginTop: 6, flexShrink: 0, boxShadow: `0 0 8px ${tpl.accent}` }} />
                    <span style={{ fontSize: 13, color: textColor, lineHeight: 1.4, fontWeight: 500, textShadow: '0 1px 8px rgba(0,0,0,0.8)' }}>{typeof b === 'string' ? b : ''}</span>
                  </div>
                ))}
              </div>
            )}
            {isCta && typeof slide.cta === 'string' && slide.cta.trim() && (
              <div style={{ marginTop: 16, padding: '12px 24px', background: tpl.accent, color: '#000', borderRadius: 10, fontWeight: 900, fontSize: 14, display: 'inline-block', width: 'fit-content', boxShadow: `0 8px 30px ${tpl.accentGlow}` }}>
                {slide.cta}
              </div>
            )}
          </div>
        );
    }
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#000',
        backgroundImage: `linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 40%, rgba(0,0,0,0.2) 100%), url("${bgImageUrl}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}
    >
      {/* Accent superior sutil */}
      <div style={{ height: 4, background: `linear-gradient(90deg, ${tpl.accent}, transparent)`, width: '100%', flexShrink: 0, zIndex: 2 }} />

      {/* Brand tag top-left */}
      <div style={{
        position: 'absolute', top: 16, left: 16, zIndex: 2,
        fontSize: 10, fontWeight: 800, letterSpacing: '0.15em',
        color: textColor, textTransform: 'uppercase',
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(8px)',
        border: `1px solid rgba(255,255,255,0.1)`,
        padding: '4px 10px', borderRadius: 6,
      }}>
        {brandName}
      </div>

      {/* Slide counter top-right */}
      <div style={{
        position: 'absolute', top: 16, right: 16, zIndex: 2,
        fontSize: 11, fontWeight: 800, color: subColor,
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
        padding: '3px 8px', borderRadius: 6,
        fontFeatureSettings: '"tnum"',
      }}>
        {slide.order}/{total}
      </div>

      {/* Main Layout Content */}
      {renderLayoutContent()}

      {/* Swipe hint */}
      {!isCta && (
        <div style={{
          position: 'absolute', bottom: 20, right: 20, zIndex: 2,
          fontSize: 10, color: subColor, display: 'flex', alignItems: 'center', gap: 4,
          fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em'
        }}>
          Arraste → 
        </div>
      )}

      <div style={{ height: 3, background: `linear-gradient(90deg, transparent, ${tpl.accent}80)`, flexShrink: 0, zIndex: 2 }} />
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

function CarouselPageViewerInner({
  slides, templateId, onTemplateChange, brandName = 'Minha Marca', caption
}: CarouselPageViewerProps) {
  const [current, setCurrent] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [loadingImages, setLoadingImages] = useState(true);
  const [loadedCount, setLoadedCount] = useState(0);

  const slideRef = useRef<HTMLDivElement>(null);
  const tpl = CAROUSEL_TEMPLATES.find(t => t.id === templateId) ?? CAROUSEL_TEMPLATES[0];

  useEffect(() => {
    let completed = 0;
    let isCancelled = false;
    const total = slides.length;

    if (!total) {
      setLoadingImages(false);
      return;
    }

    // Reseta states quando muda o carrossel inteiro
    setLoadingImages(true);
    setLoadedCount(0);

    // Timeout de segurança: Se a IA travar ou a net ficar lenta, libera a tela de qualquer jeito após 30 segundos
    const fallbackTimeout = setTimeout(() => {
      if (!isCancelled) setLoadingImages(false);
    }, 30000);

    slides.forEach((slide) => {
      const visualPrompt = encodeURIComponent(`${slide.visual_cue || slide.headline || 'creative photography'}, highly detailed, cinematic photography, realistic, 4k resolution, professional, masterpiece`);
      const seed = (slide.headline?.length || 10) * slide.order * 42;
      const bgImageUrl = `https://image.pollinations.ai/prompt/${visualPrompt}?width=1080&height=1350&nologo=true&seed=${seed}`;

      if (POLLINATIONS_CACHE.has(bgImageUrl)) {
        completed++;
        setLoadedCount(completed);
        if (completed === total) {
          clearTimeout(fallbackTimeout);
          setLoadingImages(false);
        }
        return;
      }

      fetch(bgImageUrl, { cache: 'force-cache' })
        .then(res => res.blob())
        .then(blob => {
           if (isCancelled) return;
           const objUrl = URL.createObjectURL(blob);
           POLLINATIONS_CACHE.set(bgImageUrl, objUrl);
           
           completed++;
           setLoadedCount(completed);
           if (completed === total) {
             clearTimeout(fallbackTimeout);
             setLoadingImages(false);
           }
        })
        .catch(() => {
           if (isCancelled) return;
           completed++;
           setLoadedCount(completed);
           if (completed === total) {
             clearTimeout(fallbackTimeout);
             setLoadingImages(false);
           }
        });
    });

    return () => {
      isCancelled = true;
      clearTimeout(fallbackTimeout);
    };
  }, [slides]);

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
      link.download = `slide-${String(slides[current]?.order || 0).padStart(2, '0')}-${tpl.name.toLowerCase().replace(/\s/g, '-')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (e) {
      console.error('Export failed:', e);
    } finally {
      setExporting(false);
    }
  }, [current, slides, tpl]);

  if (loadingImages) {
    return (
      <div className="flex flex-col items-center justify-center p-12 gap-6 min-h-[400px] w-full">
         <div className="relative w-16 h-16 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-t-2 border-l-2 border-pink-500 animate-spin" />
            <div className="absolute inset-2 rounded-full border-b-2 border-r-2 border-purple-500 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.2s' }} />
         </div>
         <div className="flex flex-col items-center gap-2 text-center">
           <h3 className="text-lg font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
             Revelando Fotografias IA...
           </h3>
           <p className="text-sm text-muted-foreground w-[260px]">
              Produzindo fundos cinemáticos para cada um dos slides ({loadedCount}/{slides.length})...
           </p>
         </div>
         <div className="w-56 h-1.5 bg-muted/30 rounded-full overflow-hidden mt-2">
            <div 
               className="h-full bg-gradient-to-r from-pink-500 to-purple-500 transition-all duration-300"
               style={{ width: `${Math.max(5, (loadedCount / (slides?.length || 1)) * 100)}%` }}
            />
         </div>
      </div>
    );
  }

  const slide = slides[current];

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
                <div style={{ fontSize: 36, fontWeight: 900, color: tpl.text, lineHeight: 1.1 }}>{typeof s.headline === 'string' ? s.headline : ''}</div>
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

// ─────────────────────────────────────────────────────────────────────────────
// OVERRIDE: Error Boundary para capturar crashes do React por alucinação da IA
// ─────────────────────────────────────────────────────────────────────────────
class CarouselErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null; info: ErrorInfo | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Carousel Rendering Crash:", error, info);
    this.setState({ error, info });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-6 gap-3 min-h-[400px] w-full bg-red-950/40 border border-red-500/50 rounded-xl text-center shadow-2xl backdrop-blur-md">
          <div className="text-4xl mb-2 drop-shadow-[0_0_15px_rgba(239,68,68,0.8)]">🚨</div>
          <h3 className="text-red-400 font-bold text-lg tracking-tight uppercase">Radar Anti-Crash Detectou Alucinação</h3>
          <p className="text-red-300 text-xs max-w-sm mb-2 font-medium">
            O Davi tentou desenhar o Carrossel, mas a IA do Paulo gerou um código com estrutura de JSON inválida na resposta visual (em vez de texto). O renderizador explodiria causando a Tela Preta, mas a barreira de contenção segurou o impacto!
          </p>
          <div className="bg-black/60 p-4 rounded-lg w-full text-left border border-red-500/30 text-[11px] text-red-100 font-mono shadow-inner overflow-hidden">
             <strong className="text-red-400 block mb-1 text-[10px] uppercase tracking-wider">Erro Culpado Fatal:</strong>
             {this.state.error?.toString()}
          </div>
          <div className="bg-black/40 p-3 rounded-lg w-full text-left border border-red-500/20 text-[9px] text-red-200/50 font-mono max-h-[80px] overflow-y-auto mt-1">
             <strong className="text-red-500/50 block mb-1 uppercase">Stack Trace:</strong>
             {this.state.info?.componentStack?.trim()}
          </div>
          <p className="text-xs text-white mt-4 font-bold bg-red-600/20 px-4 py-2 rounded-full border border-red-500/30">
            Mande um Print dessa Caixinha Vermelha Inteira para o engenheiro rastrear!
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

export function CarouselPageViewer(props: CarouselPageViewerProps) {
  return (
    <CarouselErrorBoundary>
      <CarouselPageViewerInner {...props} />
    </CarouselErrorBoundary>
  );
}
