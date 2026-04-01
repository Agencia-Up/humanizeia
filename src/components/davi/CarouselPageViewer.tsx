import React, { useState, useRef, useCallback, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import html2canvas from 'html2canvas';
import { ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react';
import { CarouselSlide } from '@/hooks/useSocialMedia';
import { Button } from '@/components/ui/button';

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

const POLLINATIONS_CACHE = new Map<string, string>();

function buildImageUrl(visualCue: string, headline: string, order: number, isPersonalBrand = false): string {
  const style = isPersonalBrand
    ? 'editorial photography, business professional setting, warm natural light, widescreen, cinematic, no text, 8K'
    : 'cinematic AI visualization, dark dramatic background, neon lighting, 3D holographic elements, ultra detailed, 4K, no text';
  const prompt = encodeURIComponent(
    `${visualCue || headline || 'creative abstract'}, ${style}`
  );
  const seed = ((headline?.length || 10) * (order + 1) * 37) % 9999;
  return `https://image.pollinations.ai/prompt/${prompt}?width=1080&height=1350&nologo=true&seed=${seed}`;
}

// ── FUTURISTA IA SLIDE ────────────────────────────────────────────────────────
// Layout: big cinematic image top 55% ; dark bar bottom 45% with bold text
function FuturistaSlide({ slide, tpl, brandName, total }: {
  slide: CarouselSlide;
  tpl: typeof CAROUSEL_TEMPLATES[number];
  brandName: string;
  total: number;
}) {
  const isCover = slide.type === 'cover' || slide.order === 1;
  const isCta = slide.type === 'cta' || slide.order === total;

  const visualPrompt = encodeURIComponent(
    `${slide.visual_cue || slide.image_prompt || slide.headline}, cinematic dark AI scene, neon holographic elements, 3D floating objects, dramatic lighting, ultra realistic, 8K, no text overlay`
  );
  const seed = ((slide.headline?.length || 10) * slide.order * 57) % 9999;
  const bgImgRawUrl = `https://image.pollinations.ai/prompt/${visualPrompt}?width=1080&height=730&nologo=true&seed=${seed}`;
  const bgImgUrl = POLLINATIONS_CACHE.get(bgImgRawUrl) || bgImgRawUrl;

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
        backgroundImage: `url("${bgImgUrl}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center top',
        position: 'relative',
        overflow: 'hidden',
      }}>
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
              fontSize: 9, fontWeight: 800, color: tpl.accent,
              letterSpacing: '0.12em', textTransform: 'uppercase',
            }}>
              {slide.sub_headline}
            </div>
          )}
          {/* Big headline */}
          <div style={{
            fontSize: isCover ? 22 : 19, fontWeight: 900, color: '#fff',
            lineHeight: 1.12, letterSpacing: '-0.02em',
            textShadow: `0 2px 12px rgba(0,0,0,0.8)`,
          }}>
            <HighlightHeadline text={slide.headline} accentWord={slide.accent_word} color={tpl.accent} />
          </div>
          {/* Accent line */}
          <div style={{ width: 32, height: 3, background: tpl.accent, borderRadius: 2, boxShadow: `0 0 8px ${tpl.accentGlow}` }} />
          {/* Body */}
          {typeof slide.body === 'string' && slide.body.trim() && (
            <div style={{ fontSize: 12, color: tpl.sub, lineHeight: 1.5, maxWidth: '95%' }}>
              {slide.body}
            </div>
          )}
          {/* Bullets */}
          {Array.isArray(slide.bullets) && slide.bullets.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {slide.bullets.map((b, i) => (
                <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                  <span style={{ color: tpl.accent, fontSize: 12, flexShrink: 0, marginTop: 1 }}>▸</span>
                  <span style={{ fontSize: 11, color: '#fff', lineHeight: 1.35 }}>{typeof b === 'string' ? b : ''}</span>
                </div>
              ))}
            </div>
          )}
          {/* CTA button */}
          {isCta && typeof slide.cta === 'string' && slide.cta.trim() && (
            <div style={{
              marginTop: 6, padding: '10px 20px',
              background: tpl.accent, color: '#fff', borderRadius: 24,
              fontWeight: 900, fontSize: 12, textAlign: 'center',
              boxShadow: `0 6px 24px ${tpl.accentGlow}`,
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
// Layout: creator avatar + name top ; text body middle ; widescreen image bottom
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
  const visualPrompt = encodeURIComponent(
    `${imgContext}, editorial photography, business professional, warm cinematic lighting, widescreen composition, sharp focus, no text, 8K ultra detail`
  );
  const seed = ((slide.headline?.length || 10) * slide.order * 43) % 9999;
  const bottomImgRaw = `https://image.pollinations.ai/prompt/${visualPrompt}?width=1200&height=600&nologo=true&seed=${seed}`;
  const bottomImg = POLLINATIONS_CACHE.get(bottomImgRaw) || bottomImgRaw;

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
        flex: 1, padding: '14px 20px 8px',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', gap: 8,
        overflow: 'hidden', minHeight: 0,
      }}>
        {/* Sub label on cover */}
        {isCover && typeof slide.sub_headline === 'string' && slide.sub_headline.trim() && (
          <div style={{ fontSize: 11, fontWeight: 600, color: '#555', lineHeight: 1.4 }}>
            {slide.sub_headline}
          </div>
        )}
        {/* Main text */}
        <div style={
          { fontSize: isCover ? 16 : 13, lineHeight: 1.65, color: '#111', fontWeight: 400, overflow: 'hidden' }
        }>
          {isCover ? (
            <span style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.3 }}>{slide.headline}</span>
          ) : (
            <>
              {typeof slide.sub_headline === 'string' && slide.sub_headline.trim() && (
                <div style={{ fontWeight: 700, marginBottom: 5, color: '#000', fontSize: 13 }}>{slide.sub_headline}</div>
              )}
              {typeof slide.body === 'string' && slide.body.trim() && <div style={{ marginBottom: 4 }}>{slide.body}</div>}
              {Array.isArray(slide.bullets) && slide.bullets.map((b, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginTop: 5 }}>
                  <span style={{ color: '#333', fontWeight: 700 }}>•</span>
                  <span style={{ fontWeight: 400 }}>{typeof b === 'string' ? b : ''}</span>
                </div>
              ))}
              {slide.headline && (
                <div style={{ fontWeight: 700, marginTop: 6, color: '#000', fontSize: 14 }}>
                  <HighlightHeadline text={slide.headline} accentWord={slide.accent_word} color='#1D9BF0' />
                </div>
              )}
            </>
          )}
        </div>
        {/* "Continua 👇" for non-last slides */}
        {!isCta && (
          <div style={{ fontSize: 12, color: '#444', marginTop: 'auto', paddingTop: 4 }}>Continua 👇</div>
        )}
        {/* CTA */}
        {isCta && typeof slide.cta === 'string' && slide.cta.trim() && (
          <div style={{
            marginTop: 6, padding: '10px 0',
            fontWeight: 700, fontSize: 14, color: '#111',
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
        background: '#f0f0f0', // placeholder bg while loading
      }}>
        <div
          style={{
            position: 'absolute', inset: 0,
            backgroundImage: `url("${bottomImg}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
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

  const visualPrompt = encodeURIComponent(`${slide.visual_cue || slide.headline || 'creative photography'}, highly detailed, cinematic photography, realistic, 4k resolution, professional, masterpiece`);
  const seed = (slide.headline?.length || 10) * slide.order * 42;
  const bgImageUrlRaw = `https://image.pollinations.ai/prompt/${visualPrompt}?width=1080&height=1350&nologo=true&seed=${seed}`;
  const bgImageUrl = POLLINATIONS_CACHE.get(bgImageUrlRaw) || bgImageUrlRaw;

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
      width: '100%', height: '100%', backgroundColor: '#000',
      backgroundImage: `linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 40%, rgba(0,0,0,0.2) 100%), url("${bgImageUrl}")`,
      backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
      display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
    }}>
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

// ── Preloader ─────────────────────────────────────────────────────────────────
function preloadImages(slides: CarouselSlide[], templateMode: string): string[] {
  const urls: string[] = [];
  slides.forEach(slide => {
    if (templateMode === 'image_top_text_bottom') {
      const p = encodeURIComponent(
        `${slide.visual_cue || slide.image_prompt || slide.headline}, cinematic dark AI scene, neon holographic elements, 3D floating objects, dramatic lighting, ultra realistic, 8K, no text overlay`
      );
      const seed = ((slide.headline?.length || 10) * slide.order * 57) % 9999;
      urls.push(`https://image.pollinations.ai/prompt/${p}?width=1080&height=730&nologo=true&seed=${seed}`);
    } else if (templateMode === 'avatar_text_image') {
      const p = encodeURIComponent(
        `${slide.visual_cue || slide.image_prompt || slide.headline}, editorial professional photography, business setting, warm cinematic light, widescreen landscape, high detail, no text, 8K`
      );
      const seed = ((slide.headline?.length || 10) * slide.order * 43) % 9999;
      urls.push(`https://image.pollinations.ai/prompt/${p}?width=1200&height=500&nologo=true&seed=${seed}`);
    } else {
      const p = encodeURIComponent(`${slide.visual_cue || slide.headline || 'creative photography'}, highly detailed, cinematic photography, realistic, 4k resolution, professional, masterpiece`);
      const seed = (slide.headline?.length || 10) * slide.order * 42;
      urls.push(`https://image.pollinations.ai/prompt/${p}?width=1080&height=1350&nologo=true&seed=${seed}`);
    }
  });
  return urls;
}

// ── Main component ─────────────────────────────────────────────────────────────
interface CarouselPageViewerProps {
  slides: CarouselSlide[];
  templateId: TemplateId;
  onTemplateChange: (id: TemplateId) => void;
  brandName?: string;
  caption?: string;
  clientImageUrl?: string;
}

function CarouselPageViewerInner({
  slides, templateId, onTemplateChange, brandName = 'Minha Marca', caption, clientImageUrl
}: CarouselPageViewerProps) {
  const [current, setCurrent] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [loadingImages, setLoadingImages] = useState(true);
  const [loadedCount, setLoadedCount] = useState(0);

  const slideRef = useRef<HTMLDivElement>(null);
  const tpl = CAROUSEL_TEMPLATES.find(t => t.id === templateId) ?? CAROUSEL_TEMPLATES[0];
  const templateMode = (tpl as any).layoutMode || 'standard';

  useEffect(() => {
    let completed = 0;
    let isCancelled = false;
    const total = slides.length;
    if (!total) { setLoadingImages(false); return; }
    setLoadingImages(true);
    setLoadedCount(0);
    const fallbackTimeout = setTimeout(() => { if (!isCancelled) setLoadingImages(false); }, 30000);
    const urls = preloadImages(slides, templateMode);

    urls.forEach(url => {
      if (POLLINATIONS_CACHE.has(url)) {
        completed++;
        setLoadedCount(completed);
        if (completed === total) { clearTimeout(fallbackTimeout); setLoadingImages(false); }
        return;
      }
      fetch(url, { cache: 'force-cache' })
        .then(res => res.blob())
        .then(blob => {
          if (isCancelled) return;
          POLLINATIONS_CACHE.set(url, URL.createObjectURL(blob));
          completed++;
          setLoadedCount(completed);
          if (completed === total) { clearTimeout(fallbackTimeout); setLoadingImages(false); }
        })
        .catch(() => {
          if (isCancelled) return;
          completed++;
          setLoadedCount(completed);
          if (completed === total) { clearTimeout(fallbackTimeout); setLoadingImages(false); }
        });
    });
    return () => { isCancelled = true; clearTimeout(fallbackTimeout); };
  }, [slides, templateMode]);

  const handleExport = useCallback(async () => {
    if (!slideRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(slideRef.current, { scale: 3, useCORS: true, backgroundColor: null, logging: false });
      const link = document.createElement('a');
      link.download = `slide-${String(slides[current]?.order || 0).padStart(2, '0')}-${tpl.name.toLowerCase().replace(/\s/g, '-')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (e) { console.error('Export failed:', e); }
    finally { setExporting(false); }
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
            Renderizando slides...
          </h3>
          <p className="text-sm text-muted-foreground w-[260px]">
            {tpl.id === 'futurista_ia' ? '🤖 Gerando cenas AI cinemáticas' : tpl.id === 'personal_brand' ? '👤 Preparando layout editorial' : '🎨 Produzindo fundos cinemáticos'} ({loadedCount}/{slides.length})
          </p>
        </div>
        <div className="w-56 h-1.5 bg-muted/30 rounded-full overflow-hidden mt-2">
          <div className="h-full bg-gradient-to-r from-pink-500 to-purple-500 transition-all duration-300"
            style={{ width: `${Math.max(5, (loadedCount / (slides?.length || 1)) * 100)}%` }} />
        </div>
      </div>
    );
  }

  const slide = slides[current];
  const DISPLAY_W = 300;
  const DISPLAY_H = Math.round(DISPLAY_W * (1350 / 1080));

  return (
    <div className="flex flex-col gap-3 items-center">
      {/* Main slide preview */}
      <div style={{ position: 'relative', width: DISPLAY_W, height: DISPLAY_H }}>
        <div ref={slideRef} style={{ width: DISPLAY_W, height: DISPLAY_H, borderRadius: 12, overflow: 'hidden', border: tpl.borderStyle, boxShadow: `0 8px 40px ${tpl.accentGlow}, 0 2px 8px rgba(0,0,0,0.4)`, transition: 'box-shadow 0.3s' }}>
          <SlidePageInner slide={slide} tpl={tpl} brandName={brandName} total={slides.length} clientImageUrl={clientImageUrl} />
        </div>
        {current > 0 && (
          <button onClick={() => setCurrent(p => p - 1)} style={{ position: 'absolute', left: -14, top: '50%', transform: 'translateY(-50%)', width: 28, height: 28, borderRadius: '50%', background: tpl.accent, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 12px ${tpl.accentGlow}` }}>
            <ChevronLeft style={{ width: 16, height: 16, color: '#fff' }} />
          </button>
        )}
        {current < slides.length - 1 && (
          <button onClick={() => setCurrent(p => p + 1)} style={{ position: 'absolute', right: -14, top: '50%', transform: 'translateY(-50%)', width: 28, height: 28, borderRadius: '50%', background: tpl.accent, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 12px ${tpl.accentGlow}` }}>
            <ChevronRight style={{ width: 16, height: 16, color: '#fff' }} />
          </button>
        )}
      </div>

      {/* Thumbnail strip */}
      <div style={{ display: 'flex', gap: 5, overflowX: 'auto', maxWidth: DISPLAY_W + 28, paddingBottom: 4 }}>
        {slides.map((s, i) => (
          <button key={i} onClick={() => setCurrent(i)} style={{ flexShrink: 0, width: 44, height: 55, borderRadius: 6, border: i === current ? `2px solid ${tpl.accent}` : '2px solid transparent', overflow: 'hidden', cursor: 'pointer', opacity: i === current ? 1 : 0.5, transition: 'all 0.2s', background: tpl.bg, position: 'relative' }}>
            <div style={{ transform: 'scale(0.25)', transformOrigin: 'top left', width: '400%', height: '400%', pointerEvents: 'none' }}>
              <div style={{ width: DISPLAY_W * 4, height: DISPLAY_H * 4, background: tpl.bgGradient, padding: 16 }}>
                <div style={{ fontSize: 36, fontWeight: 900, color: tpl.text, lineHeight: 1.1 }}>{typeof s.headline === 'string' ? s.headline : ''}</div>
              </div>
            </div>
            <div style={{ position: 'absolute', bottom: 2, right: 3, fontSize: 8, fontWeight: 700, color: tpl.accent }}>{i + 1}</div>
          </button>
        ))}
      </div>

      {/* Template picker */}
      <div className="flex items-center gap-1.5 justify-center flex-wrap max-w-xs">
        {CAROUSEL_TEMPLATES.map(t => (
          <button key={t.id} onClick={() => onTemplateChange(t.id as TemplateId)} title={t.name}
            style={{ width: 22, height: 22, borderRadius: '50%', background: t.id === 'personal_brand' ? '#333' : t.id === 'futurista_ia' ? '#6366F1' : (t as any).accent, border: t.id === templateId ? '3px solid white' : '2px solid transparent', cursor: 'pointer', transform: t.id === templateId ? 'scale(1.3)' : 'scale(1)', transition: 'all 0.15s', boxShadow: t.id === templateId ? `0 0 8px ${(t as any).accentGlow}` : 'none', fontSize: 10 }}>
            {t.id === 'futurista_ia' ? '🤖' : t.id === 'personal_brand' ? '👤' : ''}
          </button>
        ))}
      </div>

      {/* Export button */}
      <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting} className="gap-1.5 text-xs h-8" style={{ borderColor: tpl.accent + '60', color: tpl.accent }}>
        {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
        {exporting ? 'Exportando...' : `Baixar Slide ${slide.order}`}
      </Button>
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
