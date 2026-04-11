import React, { useState, useEffect } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { CarouselSlide } from '@/hooks/useSocialMedia';
import { Button } from '@/components/ui/button';
import { generateNativeCarousel } from './CarouselNativeRenderer';

export interface CarouselPageViewerProps {
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
    <div className="flex flex-col h-full bg-[#0a0f1d]/50 p-4 rounded-xl border border-white/5">
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
