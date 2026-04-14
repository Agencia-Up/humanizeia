import React, { useState, useRef, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import html2canvas from 'html2canvas';
import { Download, Loader2 } from 'lucide-react';
import { CarouselSlide } from '@/hooks/useSocialMedia';
import { Button } from '@/components/ui/button';

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

// ── Lazy Image Queuing Hook to prevent HTTP 429 ──────────────────────────────
const POLLINATIONS_CACHE = new Map<string, string>();
const imgQueue: string[] = [];
let isProcessingQueue = false;

const processQueue = async () => {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  while (imgQueue.length > 0) {
    const url = imgQueue[0];
    if (!POLLINATIONS_CACHE.has(url)) {
      try {
        const res = await fetch(url, { cache: 'force-cache' });
        if (res.ok) {
          const blob = await res.blob();
          POLLINATIONS_CACHE.set(url, URL.createObjectURL(blob));
        }
      } catch (e) {
        console.warn('Queue fetch failed', e);
      }
      // Speed optimized
      await new Promise(r => setTimeout(r, 600));
    }
    imgQueue.shift();
    window.dispatchEvent(new CustomEvent('pollinations_loaded', { detail: url }));
  }
  isProcessingQueue = false;
};

export function usePollinationsImage(prompt: string, width: number, height: number, seed: number) {
  // Speed optimized Pollinations (Turbo mode automatically by removing model=flux)
  const cleanPrompt = encodeURIComponent(String(prompt).substring(0, 300));
  const url = `https://image.pollinations.ai/prompt/${cleanPrompt}?width=${width}&height=${height}&nologo=true&seed=${seed}`;
  
  const [localUrl, setLocalUrl] = React.useState<string | null>(POLLINATIONS_CACHE.get(url) || null);

  React.useEffect(() => {
    if (POLLINATIONS_CACHE.has(url)) {
      setLocalUrl(POLLINATIONS_CACHE.get(url)!);
      return;
    }
    if (!imgQueue.includes(url)) {
      imgQueue.push(url);
      processQueue();
    }
    const listener = (e: any) => {
      if (e.detail === url && POLLINATIONS_CACHE.has(url)) {
        setLocalUrl(POLLINATIONS_CACHE.get(url)!);
      }
    };
    window.addEventListener('pollinations_loaded', listener);
    return () => window.removeEventListener('pollinations_loaded', listener);
  }, [url]);

  return localUrl;
}

// ── DYNAMIC FREEPIK SLIDE ────────────────────────────────────────────────────────
// Este componente decide aleatoriamente um layout de revista/editorial para cada slide
function DynamicFreepikSlide({ slide, brandName, total, clientImageUrl }: {
  slide: CarouselSlide;
  brandName: string;
  total: number;
  clientImageUrl?: string;
}) {
  const isCover = slide.type === 'cover' || slide.order === 1;
  const isCta = slide.type === 'cta' || slide.order === total;

  // Decide dynamically the accent color and layout style based on slide.order/seed
  const seedNum = (slide.headline?.length || 10) * slide.order * 61;
  const layouts = ['split_modern', 'glass_overlay', 'magazine', 'circle_cut'];
  const colors = ['#6366F1', '#10B981', '#F43F5E', '#F59E0B', '#3B82F6', '#8B5CF6'];
  
  // Capa sempre tenta um layout mais limpo, CTA também. Meios variam.
  const layout = isCover ? 'glass_overlay' : isCta ? 'glass_overlay' : layouts[seedNum % layouts.length];
  const accentColor = colors[seedNum % colors.length];

  // Motor Veloz: Prompt turbinado com DALL-E style
  const imgContext = slide.image_prompt || slide.visual_cue || slide.headline || 'abstract minimalist background';
  const visualPrompt = `${imgContext}, cinematic aesthetic, 8k resolution, photorealistic, professional editorial photography, clean composition, dark moody lighting, masterpiece, no text`;
  const bgImgUrl = usePollinationsImage(visualPrompt, 1080, 1350, seedNum);

  const AvatarIcon = () => (
    <div style={{
      position: 'absolute', top: 16, left: 16, zIndex: 10,
      display: 'flex', alignItems: 'center', gap: 8,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)',
      padding: clientImageUrl ? '4px 12px 4px 4px' : '6px 12px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.1)'
    }}>
      {clientImageUrl ? (
        <img src={clientImageUrl} alt="Brand Avatar" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} crossOrigin="anonymous" />
      ) : (
        <div style={{ width: 14, height: 14, borderRadius: '50%', background: accentColor }} />
      )}
      <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', letterSpacing: '0.1em' }}>{brandName}</span>
    </div>
  );

  const PageCounter = () => (
    <div style={{
      position: 'absolute', top: 16, right: 16, zIndex: 10,
      fontSize: 10, fontWeight: 900, color: '#fff',
      background: accentColor, borderRadius: '50%',
      width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      {slide.order}
    </div>
  );

  const commonTextShadow = '0px 2px 12px rgba(0,0,0,0.8)';
  const bgLoading = !bgImgUrl ? "animate-pulse flex items-center justify-center bg-zinc-900" : "";

  // 1. GLASS OVERLAY
  if (layout === 'glass_overlay') {
    return (
      <div style={{
        width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
        backgroundImage: bgImgUrl ? `url("${bgImgUrl}")` : 'none',
        backgroundSize: 'cover', backgroundPosition: 'center',
        fontFamily: "'Inter', sans-serif"
      }} className={bgLoading}>
        {!bgImgUrl && <Loader2 className="w-8 h-8 animate-spin text-white/30" />}
        <AvatarIcon />
        <PageCounter />
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.3) 50%, rgba(0,0,0,0.1) 100%)'
        }} />
        <div style={{
          position: 'absolute', bottom: 30, left: 24, right: 24,
          background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.15)', borderRadius: 20,
          padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 10
        }}>
          {slide.sub_headline && <span style={{ color: accentColor, fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{slide.sub_headline}</span>}
          <h1 style={{ color: '#fff', fontSize: isCover ? 32 : 26, fontWeight: 900, lineHeight: 1.15, textShadow: commonTextShadow }}>
            <HighlightHeadline text={slide.headline} accentWord={slide.accent_word} color={accentColor} />
          </h1>
          {slide.body && <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 1.5, marginTop: 4 }}>{slide.body}</p>}
          {slide.bullets && slide.bullets.length > 0 && (
            <ul style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {slide.bullets.map((b, i) => (
                <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: '#fff', fontSize: 13, fontWeight: 500 }}>
                  <span style={{ color: accentColor }}>✦</span> {b}
                </li>
              ))}
            </ul>
          )}
          {isCta && slide.cta && (
            <div style={{ marginTop: 16, background: accentColor, color: '#fff', padding: '12px 24px', borderRadius: 10, textAlign: 'center', fontWeight: 800, fontSize: 15, textTransform: 'uppercase' }}>
              {slide.cta}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 2. SPLIT MODERN
  if (layout === 'split_modern') {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        background: '#0a0a0a', fontFamily: "'Inter', sans-serif", position: 'relative'
      }}>
        <AvatarIcon />
        <PageCounter />
        <div style={{
          height: '45%', backgroundImage: bgImgUrl ? `url("${bgImgUrl}")` : 'none',
          backgroundSize: 'cover', backgroundPosition: 'center',
          position: 'relative', borderBottom: `2px solid ${accentColor}`
        }} className={bgLoading}>
          {!bgImgUrl && <Loader2 className="w-8 h-8 animate-spin text-white/30" />}
        </div>
        <div style={{ height: '55%', padding: '30px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {slide.sub_headline && <span style={{ color: accentColor, fontSize: 11, fontWeight: 900, letterSpacing: '0.15em', textTransform: 'uppercase' }}>{slide.sub_headline}</span>}
          <h1 style={{ color: '#fff', fontSize: 24, fontWeight: 900, lineHeight: 1.2 }}>
            <HighlightHeadline text={slide.headline} accentWord={slide.accent_word} color={accentColor} />
          </h1>
          <div style={{ width: 40, height: 4, background: accentColor, borderRadius: 2, margin: '8px 0' }} />
          {slide.body && <p style={{ color: '#A1A1AA', fontSize: 15, lineHeight: 1.5, fontWeight: 500 }}>{slide.body}</p>}
          {slide.bullets && slide.bullets.length > 0 && (
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 'auto' }}>
               {slide.bullets.map((b, i) => (
                <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '8px 12px', borderRadius: 8, color: '#e5e5e5', fontSize: 13, fontWeight: 600 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: accentColor }} /> {b}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // 3. MAGAZINE EDITORIAL
  if (layout === 'magazine') {
    return (
      <div style={{
        width: '100%', height: '100%', position: 'relative', background: '#f4f4f5',
        fontFamily: "'Inter', sans-serif"
      }}>
        <AvatarIcon />
        <PageCounter />
        <div style={{
          position: 'absolute', top: 0, right: 0, width: '40%', height: '100%',
          backgroundImage: bgImgUrl ? `url("${bgImgUrl}")` : 'none',
          backgroundSize: 'cover', backgroundPosition: 'center'
        }} className={bgLoading} />
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '70%', height: '100%',
          clipPath: 'polygon(0 0, 100% 0, 80% 100%, 0% 100%)',
          background: '#18181b', padding: '60px 30px 40px 24px',
          display: 'flex', flexDirection: 'column', justifyContent: 'center'
        }}>
          {slide.sub_headline && <span style={{ color: accentColor, fontSize: 13, fontWeight: 900, textTransform: 'uppercase' }}>{slide.sub_headline}</span>}
          <h1 style={{ color: '#fff', fontSize: 28, fontWeight: 900, lineHeight: 1.1, marginTop: 12 }}>
            <HighlightHeadline text={slide.headline} accentWord={slide.accent_word} color={accentColor} />
          </h1>
          {slide.body && <p style={{ color: '#a1a1aa', fontSize: 15, lineHeight: 1.6, marginTop: 16 }}>{slide.body}</p>}
          {slide.bullets && slide.bullets.length > 0 && (
            <ul style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {slide.bullets.map((b, i) => (
                <li key={i} style={{ color: '#e4e4e7', fontSize: 14, fontWeight: 500, display: 'flex', gap: 8 }}>
                  <span style={{ color: accentColor, fontWeight: 900 }}>{i+1}.</span> {b}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // 4. CIRCLE CUT
  return (
    <div style={{
      width: '100%', height: '100%', background: '#09090b', fontFamily: "'Inter', sans-serif",
      display: 'flex', flexDirection: 'column', padding: 24, position: 'relative'
    }}>
      <AvatarIcon />
      <PageCounter />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginTop: 40 }}>
        <div style={{
          width: 200, height: 200, borderRadius: '50%', overflow: 'hidden',
          border: `4px solid ${accentColor}`, boxShadow: `0 0 40px ${accentColor}40`,
          backgroundImage: bgImgUrl ? `url("${bgImgUrl}")` : 'none',
          backgroundSize: 'cover', backgroundPosition: 'center',
          flexShrink: 0, marginBottom: 30
        }} className={bgLoading} />
        
        <h1 style={{ color: '#fff', fontSize: 26, fontWeight: 900, textAlign: 'center', lineHeight: 1.2 }}>
            <HighlightHeadline text={slide.headline} accentWord={slide.accent_word} color={accentColor} />
        </h1>
        {slide.body && <p style={{ color: '#a1a1aa', fontSize: 14, textAlign: 'center', marginTop: 12, lineHeight: 1.5 }}>{slide.body}</p>}
        {slide.bullets && slide.bullets.length > 0 && (
          <div style={{ background: '#18181b', borderRadius: 16, padding: '16px 20px', width: '100%', marginTop: 20 }}>
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {slide.bullets.map((b, i) => (
                <li key={i} style={{ color: '#d4d4d8', fontSize: 13, borderBottom: '1px solid #27272a', paddingBottom: 8, display: 'flex', alignItems: 'center', gap: 8}}>
                  <div style={{width:4, height:4, background:accentColor, borderRadius:'50%'}}/> {b}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
interface CarouselPageViewerProps {
  slides: CarouselSlide[];
  brandName?: string;
  clientImageUrl?: string;
}

export function CarouselPageViewerInner({
  slides, brandName = 'Minha Marca', clientImageUrl
}: CarouselPageViewerProps) {
  const [exporting, setExporting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleExportAll = async () => {
    if (!containerRef.current) return;
    setExporting(true);
    try {
      const slideElements = containerRef.current.querySelectorAll('.davi-slide-node');
      for (let i = 0; i < slideElements.length; i++) {
        const el = slideElements[i] as HTMLElement;
        const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: null, logging: false });
        const link = document.createElement('a');
        link.download = `slide-${String(i + 1).padStart(2, '0')}-davi.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        await new Promise(res => setTimeout(res, 500)); 
      }
    } catch (e) {
      console.error('Export failed:', e);
    } finally {
      setExporting(false);
    }
  };

  const DISPLAY_W = 380;
  const DISPLAY_H = Math.round(DISPLAY_W * (1350 / 1080));

  return (
    <div className="flex flex-col w-full h-full max-h-[80vh]">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 px-2 shrink-0 gap-4 border-b border-white/5 pb-4">
        <div>
          <h2 className="text-xl font-black text-white w-full sm:w-auto mt-2">Davi Studio (Dynamic Layouts)</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {slides.length} páginas geradas velozmente
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
          <Button 
            size="icon" 
            variant="outline"
            onClick={handleExportAll} 
            disabled={exporting} 
            className="h-10 w-10 rounded-xl bg-white/5 border-white/10 hover:bg-white/10 hover:text-white transition-all shrink-0"
            title="Salvar Carrossel"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Grid of All Slides */}
      <div className="overflow-y-auto pr-2 pb-8 flex-1" ref={containerRef}>
        <div className="flex flex-wrap justify-center gap-6 pb-6">
          {slides.map((slide, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <span className="text-xs font-bold text-muted-foreground w-full text-left pl-1">
                Slide {i + 1}
              </span>
              <div 
                className="davi-slide-node shrink-0" 
                style={{ 
                  width: DISPLAY_W, 
                  height: DISPLAY_H, 
                  borderRadius: 12, 
                  overflow: 'hidden',
                  boxShadow: `0 8px 40px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.5)` 
                }}
              >
                <DynamicFreepikSlide slide={slide} brandName={brandName} total={slides.length} clientImageUrl={clientImageUrl} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Error Boundary ─────────────────────────────────────────────────────────────
class CarouselErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null; info: ErrorInfo | null }> {
  constructor(props: { children: ReactNode }) { super(props); this.state = { hasError: false, error: null, info: null }; }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Carousel Rendering Crash:", error, info); this.setState({ error, info }); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-6 gap-3 min-h-[400px] w-full bg-red-950/40 border border-red-500/50 rounded-xl text-center shadow-2xl backdrop-blur-md">
          <div className="text-4xl mb-2">🚨</div>
          <h3 className="text-red-400 font-bold text-lg tracking-tight uppercase">Erro no Carrossel</h3>
          <p className="text-red-300 text-xs max-w-sm mb-2 font-medium">O Davi encontrou um problema ao renderizar este slide.</p>
          <div className="bg-black/60 p-4 rounded-lg w-full text-left border border-red-500/30 text-[11px] text-red-100 font-mono">
            {this.state.error?.toString()}
          </div>
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
