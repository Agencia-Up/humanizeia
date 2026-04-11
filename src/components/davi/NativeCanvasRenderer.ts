export interface CanvasRenderData {
  images: string[];
  line1: string; // e.g. "TRACKER LT"
  line2: string; // e.g. "2018/2019 • 80.000 km • Automático"
  line3: string; // e.g. "R$ 107.990,00"
  footerText?: string;
  theme?: 'icom' | 'minimal' | 'dark' | 'premium';
}

interface CustomSettings {
  bgColor: string;
  bgOpacity: number;
  textColor: string;
  priceColor: string;
  modelSize: number;
  detailSize: number;
  priceSize: number;
  footerText: string;
  footerBg: string;
}

const THEMES: Record<string, CustomSettings> = {
  icom: {
    bgColor: "#003366",
    bgOpacity: 0.85,
    textColor: "#ffffff",
    priceColor: "#00ffcc",
    modelSize: 52,
    detailSize: 28,
    priceSize: 64,
    footerText: "DAVI EXCLUSIVE",
    footerBg: "#001a33",
  },
  minimal: {
    bgColor: "#ffffff",
    bgOpacity: 0.95,
    textColor: "#111111",
    priceColor: "#111111",
    modelSize: 48,
    detailSize: 24,
    priceSize: 56,
    footerText: "DAVI EXCLUSIVE",
    footerBg: "#f0f0f0",
  },
  dark: {
    bgColor: "#1a1a2e",
    bgOpacity: 0.8,
    textColor: "#e0e0e0",
    priceColor: "#00e5ff",
    modelSize: 52,
    detailSize: 28,
    priceSize: 64,
    footerText: "DAVI EXCLUSIVE",
    footerBg: "#0f0f1a",
  },
  premium: {
    bgColor: "#0d1b2a",
    bgOpacity: 0.85,
    textColor: "#e0e1dd",
    priceColor: "#48cae4",
    modelSize: 52,
    detailSize: 28,
    priceSize: 64,
    footerText: "DAVI EXCLUSIVE",
    footerBg: "#0d1b2a",
  }
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((res, rej) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });

const drawCover = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) => {
  const imgRatio = img.width / img.height;
  const boxRatio = w / h;
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  
  if (imgRatio > boxRatio) {
    // Image is wider than box
    sw = img.height * boxRatio;
    sx = (img.width - sw) / 2;
  } else {
    // Image is taller than box
    sh = img.width / boxRatio;
    sy = (img.height - sh) / 2;
  }
  
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
};

export async function generateNativeCanvas(data: CanvasRenderData): Promise<string> {
    const CANVAS_W = 1080;
    const CANVAS_H = 1920;
    const FOOTER_H = 80;

    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not initialize canvas context");

    const themeKey = data.theme || 'icom';
    const s = THEMES[themeKey] || THEMES.icom;
    // Override footer if provided
    if (data.footerText) s.footerText = data.footerText;

    // Background base color
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    try {
        const imgs = await Promise.all(data.images.map((src) => loadImage(src)));
        
        // Distribute images evenly across the canvas
        const numImages = Math.max(1, imgs.length);
        const activeAreaHeight = CANVAS_H - FOOTER_H;
        let SECTION_H = activeAreaHeight / Math.min(numImages, 3);

        // Draw up to 3 images
        for (let i = 0; i < Math.min(imgs.length, 3); i++) {
            drawCover(ctx, imgs[i], 0, i * SECTION_H, CANVAS_W, SECTION_H);
        }

        // Draw the central gradient/info box
        const blockCenterY = activeAreaHeight / 2;
        const line1 = (data.line1 || "").toUpperCase();
        const line2 = data.line2 || "";
        const line3 = data.line3 || "";

        ctx.font = `bold ${s.modelSize}px Arial, sans-serif`;
        const w1 = ctx.measureText(line1).width;
        ctx.font = `${s.detailSize}px Arial, sans-serif`;
        const w2 = ctx.measureText(line2).width;
        ctx.font = `bold ${s.priceSize}px Arial, sans-serif`;
        const w3 = ctx.measureText(line3).width;

        const maxW = Math.max(w1, w2, w3);
        const padX = 40, padY = 32;
        const blockW = maxW + padX * 2;
        const blockH = s.modelSize + s.detailSize + s.priceSize + 40 + padY * 2;
        const blockX = (CANVAS_W - blockW) / 2;
        const blockY = blockCenterY - blockH / 2;

        // Draw rounded rectangle for text background
        ctx.save();
        ctx.beginPath();
        const r = 24;
        ctx.moveTo(blockX + r, blockY);
        ctx.arcTo(blockX + blockW, blockY, blockX + blockW, blockY + blockH, r);
        ctx.arcTo(blockX + blockW, blockY + blockH, blockX, blockY + blockH, r);
        ctx.arcTo(blockX, blockY + blockH, blockX, blockY, r);
        ctx.arcTo(blockX, blockY, blockX + blockW, blockY, r);
        ctx.closePath();
        
        // Parse hex to rgba
        const v = parseInt(s.bgColor.replace("#", ""), 16);
        const rr = (v >> 16) & 255;
        const gg = (v >> 8) & 255;
        const bb = v & 255;
        
        ctx.fillStyle = `rgba(${rr},${gg},${bb},${s.bgOpacity})`;
        
        // Soft shadow for the box
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 30;
        ctx.shadowOffsetY = 15;
        ctx.fill();
        ctx.restore();

        // Write Texts
        let ty = blockY + padY + s.modelSize;
        ctx.textAlign = "center";
        ctx.fillStyle = s.textColor;
        ctx.font = `bold ${s.modelSize}px Arial, sans-serif`;
        ctx.fillText(line1, CANVAS_W / 2, ty);

        ty += s.detailSize + 16;
        ctx.font = `${s.detailSize}px Arial, sans-serif`;
        ctx.fillText(line2, CANVAS_W / 2, ty);

        ty += s.priceSize + 24;
        ctx.fillStyle = s.priceColor;
        ctx.font = `bold ${s.priceSize}px Arial, sans-serif`;
        ctx.fillText(line3, CANVAS_W / 2, ty);

        // Footer
        ctx.fillStyle = s.footerBg;
        ctx.fillRect(0, CANVAS_H - FOOTER_H, CANVAS_W, FOOTER_H);
        
        ctx.fillStyle = s.textColor === "#111111" ? "#111" : "#ffffff";
        ctx.font = `600 24px Arial, sans-serif`;
        ctx.letterSpacing = "6px";
        ctx.textAlign = "center";
        
        // Manually implement letterSpacing on canvas (not supported natively in many browsers reliably)
        const text = s.footerText;
        let finalFooterText = text.split('').join(String.fromCharCode(8202)); // hair space injection for reliable rendering
        ctx.fillText(s.footerText, CANVAS_W / 2, CANVAS_H - FOOTER_H / 2 + 8);

        return canvas.toDataURL("image/png", 0.9);
    } catch (e) {
        console.error("Canvas Render Error:", e);
        throw e;
    }
}
