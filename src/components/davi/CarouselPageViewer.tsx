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
let totalRequested = 0;
let totalLoaded = 0;

const emitProgress = () => {
  window.dispatchEvent(new CustomEvent('pollinations_progress', { detail: { total: totalRequested, loaded: totalLoaded } }));
};

const processQueue = async () => {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  while (imgQueue.length > 0) {
    const url = imgQueue[0];
    if (!POLLINATIONS_CACHE.has(url)) {
      let success = false;
      let retries = 0;
      while (!success && retries < 3) {
        try {
          const res = await fetch(url, { cache: 'force-cache' });
          if (res.ok) {
            const blob = await res.blob();
            POLLINATIONS_CACHE.set(url, URL.createObjectURL(blob));
            success = true;
          } else {
            console.warn(`Pollinations HTTP ${res.status}. Retrying...`);
            if (res.status === 429 || res.status === 406) {
              await new Promise(r => setTimeout(r, 2000 * (retries + 1))); // backoff
            }
          }
        } catch (e) {
          console.warn('Queue fetch network failed', e);
        }
        retries++;
      }
      // Speed optimized pacing between successful loads
      if (success) await new Promise(r => setTimeout(r, 600));
    }
    imgQueue.shift();
    totalLoaded++;
    emitProgress();
    window.dispatchEvent(new CustomEvent('pollinations_loaded', { detail: url }));
  }
  isProcessingQueue = false;
};

export function usePollinationsImage(prompt: string, width: number, height: number, seed: number) {
  // Speed optimized Pollinations (Turbo mode automatically by removing model=flux)
  // Permite até 1000 caracteres para suportar o super-prompt do Paulo
  const cleanPrompt = encodeURIComponent(String(prompt).substring(0, 1000));
  const url = `https://image.pollinations.ai/prompt/${cleanPrompt}?width=${width}&height=${height}&nologo=true&seed=${seed}`;
  
  const [localUrl, setLocalUrl] = React.useState<string | null>(POLLINATIONS_CACHE.get(url) || null);

  React.useEffect(() => {
    if (POLLINATIONS_CACHE.has(url)) {
      setLocalUrl(POLLINATIONS_CACHE.get(url)!);
      return;
    }
    if (!imgQueue.includes(url)) {
      totalRequested++;
      emitProgress();
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

// ── CINEMATIC AESTHETIC SLIDE (ChatGPT Reference Style) ───────────────────────
// Este layout utiliza imagens de fundo em tela cheia com tipografia limpa, elegante e legível,
// imitando as superproduções geradas pelo DALL-E 3 / Midjourney.
function DynamicFreepikSlide({ slide, brandName, total, clientImageUrl }: {
  slide: CarouselSlide;
  brandName: string;
  total: number;
  clientImageUrl?: string;
}) {
  const isCover = slide.type === 'cover' || slide.order === 1;
  const isCta = slide.type === 'cta' || slide.order === total;

  // Usa prompts detalhados do Paulo (nossa 'Direção de Arte')
  const imgContext = slide.image_prompt || slide.visual_cue || slide.headline || 'abstract minimalist background';
  
  // Como o ChatGPT faz imagens hiper-realistas, vamos forçar fotorealismo e proporção 1080x1350
  const visualPrompt = slide.image_prompt 
    ? imgContext 
    : `${imgContext}, cinematic aesthetic, 8k resolution, photorealistic, luxury editorial photography, masterpiece, no text`;
    
  // A semente é a ordem para manter consistência
  const seedNum = (slide.headline?.length || 10) * slide.order * 61;
  const bgImgUrl = usePollinationsImage(visualPrompt, 1080, 1350, seedNum);

  const bgLoading = !bgImgUrl ? "animate-pulse" : "";

  // Elementos comuns
  const AvatarIcon = () => (
    <div style={{
      position: 'absolute', top: 20, right: 20, zIndex: 10,
      display: 'flex', alignItems: 'center', gap: 6,
      background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
      padding: clientImageUrl ? '4px 12px 4px 4px' : '4px 10px', 
      borderRadius: 20, border: '1px solid rgba(255,255,255,0.1)'
    }}>
      {clientImageUrl && <img src={clientImageUrl} alt="Brand" style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' }} crossOrigin="anonymous" />}
      <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{brandName}</span>
    </div>
  );

  const PageCounter = () => (
    <div style={{
      position: 'absolute', top: 20, right: clientImageUrl ? 110 : 90, zIndex: 10,
      fontSize: 10, fontWeight: 600, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.8)'
    }}>
      {slide.order}/{total}
    </div>
  );

  // Variação inteligente do layout baseado no tipo de slide para não ficar repetitivo
  // Mas sempre mantendo a imagem full-bleed.
  const gradientOverlay = isCover 
    ? 'linear-gradient(to right, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 60%, rgba(0,0,0,0) 100%)' // Gradiente lateral para capa
    : isCta 
      ? 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.3) 100%)' // Gradiente fundo escuro para fechar
      : 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 40%, rgba(0,0,0,0.1) 100%)'; // Content padrão

  const textAlignment = isCover ? 'flex-start' : 'flex-start';
  const textContainerMargin = isCover ? 'auto 30px' : 'auto 30px 40px 30px';

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      backgroundColor: '#111', fontFamily: "'Inter', sans-serif"
    }} className={bgLoading}>
      
      {/* Background Image */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: bgImgUrl ? `url("${bgImgUrl}")` : 'none',
        backgroundSize: 'cover', backgroundPosition: 'center', zIndex: 1
      }}>
        {!bgImgUrl && <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900 border border-white/5"><Loader2 className="w-8 h-8 animate-spin text-white/30" /></div>}
      </div>

      {/* Cinematic Gradient Overlay */}
      {bgImgUrl && (
        <div style={{
          position: 'absolute', inset: 0,
          background: gradientOverlay,
          zIndex: 2
        }} />
      )}

      {/* Header Info */}
      <div style={{ position: 'relative', zIndex: 10, width: '100%' }}>
        <AvatarIcon />
        <PageCounter />
      </div>

      {/* Content Container */}
      {bgImgUrl && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          display: 'flex', flexDirection: 'column', justifyContent: isCover ? 'flex-start' : 'flex-end',
          padding: isCover ? '60px 40px' : '40px 30px',
        }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: textAlignment, maxWidth: '90%' }}>
            {/* Tagline / Subtext */}
            {slide.sub_headline && (
              <span style={{ 
                color: '#E2E8F0', fontSize: 13, fontWeight: 700, 
                textTransform: 'uppercase', letterSpacing: '0.12em', 
                background: 'rgba(255,255,255,0.1)', padding: '6px 12px', borderRadius: 4, backdropFilter: 'blur(4px)'
              }}>
                {slide.sub_headline}
              </span>
            )}
            
            {/* Headline */}
            <h1 style={{ 
              color: '#fff', 
              fontSize: isCover ? 38 : 32, 
              fontWeight: 900, 
              lineHeight: 1.1, 
              textShadow: '0 4px 12px rgba(0,0,0,0.6)',
              marginBottom: 8
            }}>
              {slide.headline}
            </h1>

            {/* Body */}
            {slide.body && (
              <p style={{ 
                color: 'rgba(255,255,255,0.9)', 
                fontSize: 16, 
                lineHeight: 1.4, 
                fontWeight: 500,
                textShadow: '0 2px 8px rgba(0,0,0,0.8)'
              }}>
                {slide.body}
              </p>
            )}

            {/* Bullets (Minimalist Icons) */}
            {slide.bullets && slide.bullets.length > 0 && (
              <ul style={{ 
                marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12, width: '100%' 
              }}>
                {slide.bullets.map((b, i) => (
                  <li key={i} style={{ 
                    display: 'flex', gap: 12, alignItems: 'flex-start', 
                    color: '#F8FAFC', fontSize: 14, fontWeight: 600, 
                    textShadow: '0 2px 6px rgba(0,0,0,0.8)'
                  }}>
                    <span style={{ color: '#fff', fontSize: 16, marginTop: -2 }}>✓</span>
                    <span style={{ lineHeight: 1.4 }}>{b}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* CTA Button */}
            {isCta && slide.cta && (
              <div style={{ 
                marginTop: 30, background: '#fff', color: '#000', 
                padding: '14px 32px', borderRadius: 30, 
                fontWeight: 800, fontSize: 14, textTransform: 'uppercase',
                display: 'flex', alignItems: 'center', gap: 8,
                boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
              }}>
                {slide.cta} →
              </div>
            )}
          </div>
        </div>
      )}
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
  const [progress, setProgress] = useState(() => ({ total: totalRequested, loaded: totalLoaded }));
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Zero progress on mount if we're dealing with new slides AND it's already done
    if (totalRequested > 0 && totalRequested === totalLoaded) {
      totalRequested = 0;
      totalLoaded = 0;
      setProgress({ total: 0, loaded: 0 });
    } else {
      // Catch up any progress missed between render and effect
      setProgress({ total: totalRequested, loaded: totalLoaded });
    }
    
    const listener = (e: any) => setProgress(e.detail);
    window.addEventListener('pollinations_progress', listener);
    return () => window.removeEventListener('pollinations_progress', listener);
  }, []);

  const isGenerating = progress.total > 0 && progress.loaded < progress.total;

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

      {/* Progress Tracker */}
      {isGenerating && progress.total > 0 && (
        <div className="w-full bg-black/40 rounded-full h-1.5 mb-4 overflow-hidden shadow-inner border border-white/5 relative">
          <div 
            className="h-full bg-gradient-to-r from-pink-500 to-purple-500 transition-all duration-300 ease-out"
            style={{ width: `${Math.max(10, (progress.loaded / progress.total) * 100)}%` }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[9px] font-black tracking-widest text-white/50 drop-shadow-md">
              RENDERIZANDO {progress.loaded}/{progress.total}
            </span>
          </div>
        </div>
      )}

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
