import React, { useState, useEffect } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { CarouselSlide } from '@/hooks/useSocialMedia';
import { Button } from '@/components/ui/button';
import { generateNativeCarousel } from './CarouselNativeRenderer';

<<<<<<< HEAD
export interface CarouselPageViewerProps {
=======
// ── Template definitions ──────────────────────────────────────────────────────
export const CAROUSEL_TEMPLATES = [
  // ── FUTURISTA IA (Model 1 reference) ─────────────────────────────────────
  {
    id: 'futurista_ia',
    name: 'Futurista IA',
    emoji: '🤖',
    bg: '#050816',
    bgGradient: 'linear-gradient(180deg, #050816 0%, #0a1628 100%)',
    bgPattern: 'radial-gradient(ellipse at 50% 0%, rgba(99,102,241,0.25) 0%, transparent 60%)',
    bgSize: '100% 100%',
    accent: '#6366F1',
    accentGlow: 'rgba(99,102,241,0.45)',
    text: '#FFFFFF',
    sub: 'rgba(255,255,255,0.75)',
    muted: '#1e2a4a',
    fontWeight: '900',
    borderStyle: '1px solid rgba(99,102,241,0.3)',
    // Specific layout hint for this template
    layoutMode: 'image_top_text_bottom',
  },
  // ── PERSONAL BRAND (Model 2 reference) ────────────────────────────────────
  {
    id: 'personal_brand',
    name: 'Personal Brand',
    emoji: '👤',
    bg: '#FAFAF8',
    bgGradient: '#FFFFFF',
    bgPattern: '',
    bgSize: '100% 100%',
    accent: '#111111',
    accentGlow: 'rgba(0,0,0,0.1)',
    text: '#111111',
    sub: '#555555',
    muted: '#E5E5E5',
    fontWeight: '400',
    borderStyle: '1px solid #E5E5E5',
    layoutMode: 'avatar_text_image',
  },
  // ── DARK PRO ──────────────────────────────────────────────────────────────
  {
    id: 'dark_pro',
    name: 'Dark Pro',
    emoji: '🖤',
    bg: '#0A0A0A',
    bgGradient: 'linear-gradient(135deg, #0A0A0A 0%, #1A1A2E 100%)',
    bgPattern: 'radial-gradient(circle at 10% 20%, rgba(124,58,237,0.15) 0%, transparent 50%)',
    bgSize: '100% 100%',
    accent: '#7C3AED',
    accentGlow: 'rgba(124,58,237,0.3)',
    text: '#FFFFFF',
    sub: '#A1A1AA',
    muted: '#3F3F46',
    fontWeight: '800',
    borderStyle: '2px solid rgba(124,58,237,0.4)',
    layoutMode: 'standard',
  },
  // ── GOLD ELITE ────────────────────────────────────────────────────────────
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
    layoutMode: 'standard',
  },
  // ── EDITORIAL ─────────────────────────────────────────────────────────────
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
    layoutMode: 'standard',
  },
  // ── NEON ──────────────────────────────────────────────────────────────────
  {
    id: 'neon',
    name: 'Neon',
    emoji: '⚡',
    bg: '#050510',
    bgGradient: '#050510',
    bgPattern: 'radial-gradient(circle at 50% -20%, rgba(0,255,136,0.25) 0%, transparent 60%)',
    bgSize: '100% 100%',
    accent: '#00FF88',
    accentGlow: 'rgba(0,255,136,0.25)',
    text: '#FFFFFF',
    sub: '#7EFFC5',
    muted: '#1A1A3E',
    fontWeight: '900',
    borderStyle: '1px solid rgba(0,255,136,0.4)',
    layoutMode: 'standard',
  },
  // ── CLEAN LIGHT ───────────────────────────────────────────────────────────
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
    layoutMode: 'standard',
  },
  // ── ROSE GOLD ─────────────────────────────────────────────────────────────
  {
    id: 'rose',
    name: 'Rose Gold',
    emoji: '🌹',
    bg: '#120008',
    bgGradient: '#120008',
    bgPattern: 'radial-gradient(ellipse at center, rgba(251,113,133,0.15) 0%, transparent 70%)',
    bgSize: '100% 100%',
    accent: '#FB7185',
    accentGlow: 'rgba(251,113,133,0.3)',
    text: '#FFF0F3',
    sub: '#FCA5B4',
    muted: '#3D001A',
    fontWeight: '800',
    borderStyle: '1px solid rgba(251,113,133,0.4)',
    layoutMode: 'standard',
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
      // Delay mandatory to prevent Pollinations from blocking the IP
      await new Promise(r => setTimeout(r, 1200));
    }
    imgQueue.shift();
    window.dispatchEvent(new CustomEvent('pollinations_loaded', { detail: url }));
  }
  isProcessingQueue = false;
};

export function usePollinationsImage(prompt: string, width: number, height: number, seed: number) {
  // Truncate prompt to prevent URL Too Long errors from giant copywriter prompts
  const cleanPrompt = encodeURIComponent(String(prompt).substring(0, 250));
  const url = `https://image.pollinations.ai/prompt/${cleanPrompt}?width=${width}&height=${height}&nologo=true&seed=${seed}&model=flux`;
  
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

// ── FUTURISTA IA SLIDE ────────────────────────────────────────────────────────
function FuturistaSlide({ slide, tpl, brandName, total }: {
  slide: CarouselSlide;
  tpl: typeof CAROUSEL_TEMPLATES[number];
  brandName: string;
  total: number;
}) {
  const isCover = slide.type === 'cover' || slide.order === 1;
  const isCta = slide.type === 'cta' || slide.order === total;

  const visualPrompt = `${slide.visual_cue || slide.image_prompt || slide.headline}, cinematic dark AI scene, neon holographic elements, 3D floating objects, dramatic lighting, ultra realistic, 8K, no text overlay`;
  const seed = ((slide.headline?.length || 10) * slide.order * 57) % 9999;
  const bgImgUrl = usePollinationsImage(visualPrompt, 1080, 730, seed);

  return (
    <div style={{
      width: '100%', height: '100%',
      background: tpl.bgGradient,
      display: 'flex', flexDirection: 'column',
      fontFamily: "'Inter', 'Helvetica Neue', sans-serif",
      position: 'relative', overflow: 'hidden',
    }}>
      {/* TOP — Cinematic image (55%) */}
      <div style={{
        flex: '0 0 55%',
        backgroundImage: bgImgUrl ? `url("${bgImgUrl}")` : 'none',
        backgroundSize: 'cover',
        backgroundPosition: 'center top',
        position: 'relative',
        overflow: 'hidden',
      }} className={!bgImgUrl ? "animate-pulse bg-slate-900 flex items-center justify-center" : ""}>
        {!bgImgUrl && (
          <div className="flex flex-col items-center gap-2 opacity-50">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
            <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest">Renderizando IA...</span>
          </div>
        )}
        {/* Gradient fade bottom */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%',
          background: `linear-gradient(to bottom, transparent, ${tpl.bg})`,
        }} />
        {/* Brand top-left */}
        <div style={{
          position: 'absolute', top: 14, left: 14, zIndex: 2,
          fontSize: 9, fontWeight: 800, letterSpacing: '0.15em',
          color: '#fff', textTransform: 'uppercase',
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.15)', padding: '4px 10px', borderRadius: 6,
        }}>
          {brandName}
        </div>
        {/* Slide counter */}
        <div style={{
          position: 'absolute', top: 14, right: 14, zIndex: 2,
          fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.7)',
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
          padding: '3px 8px', borderRadius: 6,
        }}>
          {slide.order}/{total}
        </div>
      </div>

      {/* BOTTOM — Text area (45%) */}
      <div style={{
        flex: '0 0 45%',
        background: tpl.bgGradient,
        padding: '16px 20px 14px',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        position: 'relative',
      }}>
        {/* Top accent bar */}
        <div style={{
          position: 'absolute', top: 0, left: 20, right: 20, height: 2,
          background: `linear-gradient(90deg, ${tpl.accent}, transparent)`,
        }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Sub-label */}
          {typeof slide.sub_headline === 'string' && slide.sub_headline.trim() && (
            <div style={{
              fontSize: 12, fontWeight: 800, color: tpl.accent,
              letterSpacing: '0.15em', textTransform: 'uppercase',
            }}>
              {slide.sub_headline}
            </div>
          )}
          {/* Big headline */}
          <div style={{
            fontSize: isCover ? 32 : 25, fontWeight: 900, color: '#fff',
            lineHeight: 1.1, letterSpacing: '-0.02em',
            textShadow: `0 2px 12px rgba(0,0,0,0.8)`,
          }}>
            <HighlightHeadline text={slide.headline} accentWord={slide.accent_word} color={tpl.accent} />
          </div>
          {/* Accent line */}
          <div style={{ width: 44, height: 4, background: tpl.accent, borderRadius: 2, boxShadow: `0 0 12px ${tpl.accentGlow}`, marginTop: 4, marginBottom: 4 }} />
          {/* Body */}
          {typeof slide.body === 'string' && slide.body.trim() && (
            <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.9)', lineHeight: 1.5, maxWidth: '100%', fontWeight: 500 }}>
              {slide.body}
            </div>
          )}
          {/* Bullets */}
          {Array.isArray(slide.bullets) && slide.bullets.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              {slide.bullets.map((b, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ color: tpl.accent, fontSize: 16, flexShrink: 0, marginTop: 0 }}>✓</span>
                  <span style={{ fontSize: 14, color: '#fff', lineHeight: 1.45, fontWeight: 500 }}>{typeof b === 'string' ? b : ''}</span>
                </div>
              ))}
            </div>
          )}
          {/* CTA button */}
          {isCta && typeof slide.cta === 'string' && slide.cta.trim() && (
            <div style={{
              marginTop: 10, padding: '14px 24px',
              background: tpl.accent, color: '#fff', borderRadius: 28,
              fontWeight: 900, fontSize: 15, textAlign: 'center',
              boxShadow: `0 6px 24px ${tpl.accentGlow}`,
              textTransform: 'uppercase', letterSpacing: '0.05em'
            }}>
              {slide.cta}
            </div>
          )}
        </div>

        {/* Swipe hint */}
        {!isCta && (
          <div style={{
            fontSize: 9, color: 'rgba(255,255,255,0.35)',
            fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em',
            textAlign: 'right',
          }}>
            ARRASTA PRO LADO ›››
          </div>
        )}
      </div>
    </div>
  );
}

// ── PERSONAL BRAND SLIDE ──────────────────────────────────────────────────────
function PersonalBrandSlide({ slide, tpl, brandName, total, clientImageUrl }: {
  slide: CarouselSlide;
  tpl: typeof CAROUSEL_TEMPLATES[number];
  brandName: string;
  total: number;
  clientImageUrl?: string;
}) {
  const isCover = slide.type === 'cover' || slide.order === 1;
  const isCta = slide.type === 'cta' || slide.order === total;
  const [avatarError, setAvatarError] = React.useState(false);

  // Use image_prompt > visual_cue > headline for the bottom editorial image
  const imgContext = slide.image_prompt || slide.visual_cue || slide.headline || 'professional business photography';
  const visualPrompt = `${imgContext}, editorial photography, business professional, warm cinematic lighting, widescreen composition, sharp focus, no text, 8K ultra detail`;
  const seed = ((slide.headline?.length || 10) * slide.order * 43) % 9999;
  const bottomImg = usePollinationsImage(visualPrompt, 1200, 600, seed);

  // Initial for avatar placeholder
  const initial = (brandName || 'MC').charAt(0).toUpperCase();
  const showAvatar = !!(clientImageUrl && !avatarError);

  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#FFFFFF',
      display: 'flex', flexDirection: 'column',
      fontFamily: "'Inter', 'Helvetica Neue', sans-serif",
      position: 'relative', overflow: 'hidden',
    }}>
      {/* TOP — Creator avatar + name */}
      <div style={{
        padding: '18px 20px 0',
        display: 'flex', alignItems: 'center', gap: 12,
        flexShrink: 0,
      }}>
        {/* Avatar */}
        <div style={{
          width: 50, height: 50, borderRadius: '50%',
          overflow: 'hidden', flexShrink: 0,
          border: '2px solid #E5E5E5',
          background: '#F0F0F0',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}>
          {showAvatar ? (
            <img
              src={clientImageUrl}
              alt={brandName}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              onError={() => setAvatarError(true)}
              crossOrigin="anonymous"
            />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{initial}</span>
            </div>
          )}
        </div>
        {/* Name + handle */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#111', lineHeight: 1 }}>{brandName}</span>
            {/* Verified badge */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="12" fill="#1D9BF0" />
              <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span style={{ fontSize: 10, color: '#888' }}>
            @{brandName.toLowerCase().replace(/\s+/g, '')}
          </span>
        </div>
      </div>

      {/* MIDDLE — Narrative text (flex: 1 to fill remaining space) */}
      <div style={{
        flex: 1, padding: '16px 22px 10px',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', gap: 10,
        overflow: 'hidden', minHeight: 0,
      }}>
        {/* Sub label on cover */}
        {isCover && typeof slide.sub_headline === 'string' && slide.sub_headline.trim() && (
          <div style={{ fontSize: 13, fontWeight: 800, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {slide.sub_headline}
          </div>
        )}
        {/* Main text */}
        <div style={
          { fontSize: isCover ? 18 : 15, lineHeight: 1.6, color: '#111', fontWeight: 500, overflow: 'hidden' }
        }>
          {isCover ? (
            <span style={{ fontWeight: 800, fontSize: 30, lineHeight: 1.15, letterSpacing: '-0.02em' }}>{slide.headline}</span>
          ) : (
            <>
              {typeof slide.sub_headline === 'string' && slide.sub_headline.trim() && (
                <div style={{ fontWeight: 800, marginBottom: 8, color: '#000', fontSize: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{slide.sub_headline}</div>
              )}
              {typeof slide.body === 'string' && slide.body.trim() && <div style={{ marginBottom: 6, fontSize: 15, lineHeight: 1.5 }}>{slide.body}</div>}
              {Array.isArray(slide.bullets) && slide.bullets.map((b, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <span style={{ color: '#1D9BF0', fontWeight: 800, fontSize: 18, lineHeight: 1 }}>•</span>
                  <span style={{ fontWeight: 500, fontSize: 14, lineHeight: 1.45 }}>{typeof b === 'string' ? b : ''}</span>
                </div>
              ))}
              {slide.headline && (
                <div style={{ fontWeight: 800, marginTop: 10, color: '#000', fontSize: 22, lineHeight: 1.15 }}>
                  <HighlightHeadline text={slide.headline} accentWord={slide.accent_word} color='#1D9BF0' />
                </div>
              )}
            </>
          )}
        </div>
        {/* "Continua 👇" for non-last slides */}
        {!isCta && (
          <div style={{ fontSize: 13, color: '#777', fontWeight: 700, marginTop: 'auto', paddingTop: 6, textAlign: 'center' }}>CONTINUA ››</div>
        )}
        {/* CTA */}
        {isCta && typeof slide.cta === 'string' && slide.cta.trim() && (
          <div style={{
            marginTop: 10, padding: '12px 0',
            fontWeight: 800, fontSize: 16, color: '#fff', background: '#1D9BF0',
            borderRadius: 8, textAlign: 'center', boxShadow: '0 4px 14px rgba(29, 155, 240, 0.4)'
          }}>
            {slide.cta}
          </div>
        )}
      </div>

      {/* BOTTOM — Widescreen editorial image (fixed height) */}
      <div style={{
        flexShrink: 0,
        height: '38%',
        margin: '0 16px 14px',
        borderRadius: 10,
        overflow: 'hidden',
        position: 'relative',
        background: '#f0f0f0', 
      }} className={!bottomImg ? "animate-pulse flex items-center justify-center bg-gray-200" : ""}>
        {!bottomImg && (
          <div className="flex flex-col items-center gap-2 opacity-60">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Carregando Cena...</span>
          </div>
        )}
        {bottomImg && (
          <div
            style={{
              position: 'absolute', inset: 0,
              backgroundImage: `url("${bottomImg}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
        )}
        {/* Subtle gradient overlay bottom */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '30%',
          background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.15))',
        }} />
      </div>
    </div>
  );
}

// ── STANDARD DARK SLIDE ───────────────────────────────────────────────────────
function StandardSlide({ slide, tpl, brandName, total }: {
  slide: CarouselSlide;
  tpl: typeof CAROUSEL_TEMPLATES[number];
  brandName: string;
  total: number;
}) {
  const isCover = slide.type === 'cover' || slide.order === 1;
  const isCta = slide.type === 'cta' || slide.order === total;
  const isLight = (tpl.bg as string) === '#FAFAFA' || (tpl.bg as string) === '#FFFFFF' || (tpl.bg as string) === '#FAFAF8';
  const textColor = isLight ? tpl.text : '#ffffff';
  const subColor = isLight ? tpl.sub : 'rgba(255,255,255,0.85)';

  const visualPrompt = `${slide.visual_cue || slide.headline || 'creative photography'}, highly detailed, cinematic photography, realistic, 4k resolution, professional, masterpiece`;
  const seed = (slide.headline?.length || 10) * slide.order * 42;
  const bgImageUrl = usePollinationsImage(visualPrompt, 1080, 1350, seed);

  let layout = slide.layout || 'left';
  if ((layout as string) === 'left' || (layout as string) === 'default') {
    if (isCover) layout = 'centered';
    else if (isCta) layout = 'centered';
    else {
      const cadence: Array<'minimal' | 'centered' | 'left'> = ['minimal', 'centered', 'left'];
      layout = cadence[(slide.order - 2 + cadence.length) % cadence.length];
    }
  }

  const renderContent = () => {
    if (layout === 'centered') {
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
            <div style={{ marginTop: 24, padding: '14px 28px', background: tpl.accent, color: '#fff', borderRadius: 30, fontWeight: 900, fontSize: 15, boxShadow: `0 8px 32px ${tpl.accentGlow}` }}>
              {slide.cta}
            </div>
          )}
        </div>
      );
    }

    if (layout === 'minimal') {
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 1 }}>
          <div style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(16px)', border: `1px solid ${tpl.accent}50`, borderRadius: 20, padding: 28, display: 'flex', flexDirection: 'column', gap: 12, width: '100%', boxShadow: `0 20px 40px rgba(0,0,0,0.5)` }}>
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
    }

    // Default: left
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '40px 24px 40px', zIndex: 1, gap: 10 }}>
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
  };

  return (
    <div style={{
      width: '100%', height: '100%', backgroundColor: bgImageUrl ? '#000' : tpl.bg,
      backgroundImage: bgImageUrl 
        ? `linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 40%, rgba(0,0,0,0.2) 100%), url("${bgImageUrl}")`
        : 'none',
      backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
      display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
    }} className={!bgImageUrl ? "animate-pulse" : ""}>
      {!bgImageUrl && (
        <div className="absolute inset-0 flex flex-col items-center justify-center opacity-30 pointer-events-none z-0">
          <Loader2 className={`w-12 h-12 animate-spin mb-3 ${isLight ? 'text-gray-400' : 'text-white'}`} />
          <span className={`text-xs font-bold uppercase tracking-widest ${isLight ? 'text-gray-500' : 'text-gray-300'}`}>Gerando Fundo...</span>
        </div>
      )}
      <div style={{ height: 4, background: `linear-gradient(90deg, ${tpl.accent}, transparent)`, width: '100%', flexShrink: 0, zIndex: 2 }} />
      <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 2, fontSize: 10, fontWeight: 800, letterSpacing: '0.15em', color: '#fff', textTransform: 'uppercase', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)', padding: '4px 10px', borderRadius: 6 }}>
        {brandName}
      </div>
      <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 2, fontSize: 11, fontWeight: 800, color: subColor, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', padding: '3px 8px', borderRadius: 6, fontFeatureSettings: '"tnum"' }}>
        {slide.order}/{total}
      </div>
      {renderContent()}
      {!isCta && (
        <div style={{ position: 'absolute', bottom: 20, right: 20, zIndex: 2, fontSize: 10, color: subColor, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Arraste →
        </div>
      )}
      <div style={{ height: 3, background: `linear-gradient(90deg, transparent, ${tpl.accent}80)`, flexShrink: 0, zIndex: 2 }} />
    </div>
  );
}

// ── Main SlidePage dispatcher ─────────────────────────────────────────────────
function SlidePageInner({ slide, tpl, brandName, total, clientImageUrl }: {
  slide: CarouselSlide;
  tpl: typeof CAROUSEL_TEMPLATES[number];
  brandName: string;
  total: number;
  clientImageUrl?: string;
}) {
  const mode = (tpl as any).layoutMode || 'standard';
  if (mode === 'image_top_text_bottom') {
    return <FuturistaSlide slide={slide} tpl={tpl} brandName={brandName} total={total} />;
  }
  if (mode === 'avatar_text_image') {
    return <PersonalBrandSlide slide={slide} tpl={tpl} brandName={brandName} total={total} clientImageUrl={clientImageUrl} />;
  }
  return <StandardSlide slide={slide} tpl={tpl} brandName={brandName} total={total} />;
}

// ── Main component ─────────────────────────────────────────────────────────────
interface CarouselPageViewerProps {
>>>>>>> origin/dev-aloan
  slides: CarouselSlide[];
  templateId: string;
  onTemplateChange: (t: string) => void;
  brandName?: string;
  clientImages?: string[];
}

export function CarouselPageViewer({ slides, templateId, onTemplateChange, brandName = 'Minha Empresa', clientImages = [] }: CarouselPageViewerProps) {
  const [renderedImages, setRenderedImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    
    async function renderAll() {
      setLoading(true);
      setError(null);
      try {
        const images = await generateNativeCarousel({
          slides,
          attachedImages: clientImages,
          theme: templateId || 'icom',
          brandName
        });
        if (mounted) {
          setRenderedImages(images);
          setLoading(false);
        }
      } catch (err: any) {
        console.error('Failed to generate native carousel slides', err);
        if (mounted) {
          setError(err.message || 'Erro ao gerar carrossel.');
          setLoading(false);
        }
      }
    }

    renderAll();

    return () => { mounted = false; };
  }, [slides, templateId, brandName, clientImages]);

  const handleExportAll = async () => {
    setExporting(true);
    try {
      for (let i = 0; i < renderedImages.length; i++) {
        const a = document.createElement('a');
        a.href = renderedImages[i];
        a.download = `Slide_${String(i + 1).padStart(2, '0')}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Small delay to allow browser to process downloads
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center h-full w-full">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mb-4" />
        <p className="text-sm text-emerald-100/70">Renderizando Canvas Nativamente (Pollinations AI)...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-900/20 border border-red-500/30 rounded-xl text-center">
        <p className="text-red-400 font-medium">Erro ao gerar slides nativos</p>
        <p className="text-xs text-red-300 mt-2">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-h-[85vh] bg-[#0a0f1d]/50 p-4 rounded-xl border border-white/5 w-full">
      <div className="flex justify-between items-center bg-black/40 backdrop-blur-md rounded-2xl p-2 px-4 shadow-lg border border-white/10 mb-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-white tracking-tight">Galeria de Slides</h3>
          <span className="text-[10px] uppercase font-bold tracking-widest text-[#a1a1aa] bg-[#27272a]/50 px-2.5 py-0.5 rounded-full border border-white/5">
            {renderedImages.length} páginas (Native)
          </span>
        </div>
        
        <div className="flex gap-2">
          <Button 
            size="icon" 
            variant="outline"
            onClick={handleExportAll} 
            disabled={exporting} 
            className="h-10 w-10 rounded-xl bg-white/5 border-white/10 hover:bg-emerald-500/20 hover:text-emerald-400 hover:border-emerald-500/30 transition-all shrink-0"
            title="Salvar Carrossel Nativamente"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="overflow-y-auto pr-2 pb-8 flex-1">
        <div className="flex flex-wrap justify-center gap-6 pb-6">
          {renderedImages.map((imgBase64, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <span className="text-xs font-bold text-emerald-500/80 w-full text-left pl-1">
                Slide {i + 1}
              </span>
              <img 
                src={imgBase64} 
                className="w-full max-w-[280px] h-auto object-cover rounded-xl shadow-xl border border-white/10"
                alt={`Slide ${i + 1} Gerado`}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
