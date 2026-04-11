import { CarouselSlide } from '@/hooks/useSocialMedia';

const CANVAS_W = 1080;
const CANVAS_H = 1350; // Instagram Portrait Feed aspect ratio

// helper: load image
const loadImage = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Failed to load image: ${src}`));
    // Use pollinations.ai for background generation if prompted
    img.src = src;
  });
};

export interface GenerateCarouselProps {
  slides: CarouselSlide[];
  attachedImages?: string[];
  theme?: string;
  brandName?: string;
}

export async function generateNativeCarousel({
  slides,
  attachedImages = [],
  theme = 'modern_bold',
  brandName = 'DAVI exclusive'
}: GenerateCarouselProps): Promise<string[]> {
  const renderedSlides: string[] = [];
  
  // Set up canvas
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) throw new Error('Não foi possível obter contexto 2D do Canvas');

  // Load attached images into memory first
  const loadedAttachedImages: HTMLImageElement[] = [];
  for (const src of attachedImages) {
    try {
      loadedAttachedImages.push(await loadImage(src));
    } catch (e) {
      console.warn('Could not load attached image', src);
    }
  }

  // Pre-load pollinations generated images if needed
  // We don't want to block everything sequentially, but let's do it simply for now
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    
    // Clear canvas
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // 1. BACKGROUND
    // Try to use an attached image via rotation
    let bgImg: HTMLImageElement | null = null;
    if (loadedAttachedImages.length > 0) {
      bgImg = loadedAttachedImages[i % loadedAttachedImages.length];
    } else {
      // If no attached image, generate an automatic background via Pollinations AI
      const prompt = slide.visual_cue || slide.headline || 'abstract professional background aesthetic minimal';
      const encodedPrompt = encodeURIComponent(`cinematic dark background ${prompt} high resolution`);
      const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${CANVAS_W}&height=${CANVAS_H}&nologo=true&seed=${i}`;
      try {
        bgImg = await loadImage(pollinationsUrl);
      } catch (e) {
        console.warn('Could not fetch auto background from pollinations');
      }
    }

    // Fill background solid color first as fallback
    const config = slide.visual_config || {};
    const bgColor = config.bg || '#050510';
    const textColor = config.text || '#ffffff';
    const accentColor = config.accent || '#48cae4';
    
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Draw background Image
    if (bgImg) {
      const scale = Math.max(CANVAS_W / bgImg.width, CANVAS_H / bgImg.height);
      const w = bgImg.width * scale;
      const h = bgImg.height * scale;
      const x = (CANVAS_W - w) / 2;
      const y = (CANVAS_H - h) / 2;
      
      ctx.globalAlpha = 1.0;
      ctx.drawImage(bgImg, x, y, w, h);

      // Add a dark overlay so text is readable
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.globalAlpha = 1.0;

      // Add a subtle gradient from bottom
      const gradient = ctx.createLinearGradient(0, CANVAS_H * 0.4, 0, CANVAS_H);
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.9)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    // 2. TEXT RENDERING
    // Setup typography
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    
    // Draw "Slide index / Total"
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '500 24px Inter, sans-serif';
    ctx.fillText(`${i + 1} / ${slides.length}`, 80, 80);

    // Headline
    ctx.fillStyle = accentColor;
    ctx.font = '900 85px Inter, Arial, sans-serif';
    
    const words = (slide.headline || 'Conteúdo Premium').split(' ');
    let currentLine = '';
    let currentY = 220;
    const maxWidth = CANVAS_W - 160;

    for (let j = 0; j < words.length; j++) {
      const testLine = currentLine + words[j] + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && j > 0) {
        ctx.fillText(currentLine, 80, currentY);
        currentLine = words[j] + ' ';
        currentY += 100;
      } else {
        currentLine = testLine;
      }
    }
    ctx.fillText(currentLine, 80, currentY);

    // Body text
    if (slide.body) {
      currentY += 140;
      ctx.fillStyle = textColor;
      ctx.font = '400 42px Inter, Arial, sans-serif';
      
      const bodyWords = slide.body.split(' ');
      let bLine = '';
      for (let j = 0; j < bodyWords.length; j++) {
        const testLine = bLine + bodyWords[j] + ' ';
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && j > 0) {
          ctx.fillText(bLine, 80, currentY);
          bLine = bodyWords[j] + ' ';
          currentY += 60;
        } else {
          bLine = testLine;
        }
      }
      ctx.fillText(bLine, 80, currentY);
    }

    // Bullets
    if (slide.bullets && slide.bullets.length > 0) {
      currentY += (slide.body ? 100 : 140);
      ctx.fillStyle = textColor;
      ctx.font = '500 38px Inter, Arial, sans-serif';
      slide.bullets.forEach((bullet: string, bIndex: number) => {
        ctx.fillText(`•  ${bullet}`, 80, currentY);
        currentY += 60;
      });
    }

    // Call to Action (if CTA slide)
    if (i === slides.length - 1 || slide.type === 'cta') {
      currentY += 100;
      ctx.fillStyle = accentColor;
      ctx.font = '800 50px Inter, Arial, sans-serif';
      ctx.fillText('💬 Salve e Comente!', 80, currentY);
    }

    // Draw swipe indicator
    if (i < slides.length - 1) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 30px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('Deslize ➔', CANVAS_W - 80, CANVAS_H - 100);
    }

    // 3. FOOTER
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.font = '700 30px Inter, Arial, sans-serif';
    ctx.fillText(brandName, 80, CANVAS_H - 100);

    // Extract base64
    renderedSlides.push(canvas.toDataURL('image/png', 0.9));
  }

  return renderedSlides;
}
