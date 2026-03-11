import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  Upload, ImagePlus, Layers, Image as ImageIcon,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface SavedCreative {
  id: string;
  file_url: string;
  name: string;
}

interface CombineToolPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOverlaySelected: (image: string) => void;
  onCombine: () => void;
  isProcessing: boolean;
  savedImages: SavedCreative[];
}

export function CombineToolPanel({
  open,
  onOpenChange,
  onOverlaySelected,
  savedImages,
}: CombineToolPanelProps) {
  const { toast } = useToast();
  const overlayInputRef = useRef<HTMLInputElement>(null);

  const handleOverlayFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Arquivo inválido', description: 'Selecione uma imagem.', variant: 'destructive' });
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      toast({ title: 'Arquivo muito grande', description: 'Limite de 12MB.', variant: 'destructive' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      onOverlaySelected(ev.target?.result as string);
      onOpenChange(false);
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be selected again
    if (overlayInputRef.current) overlayInputRef.current.value = '';
  };

  const handleSelectSaved = async (img: SavedCreative) => {
    try {
      const resp = await fetch(img.file_url);
      const blob = await resp.blob();
      const reader = new FileReader();
      reader.onload = (ev) => {
        onOverlaySelected(ev.target?.result as string);
        onOpenChange(false);
      };
      reader.readAsDataURL(blob);
    } catch {
      onOverlaySelected(img.file_url);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Adicionar imagem para combinar
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Upload area */}
          <div
            className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/25 p-8 transition-colors hover:border-primary/50 hover:bg-muted/20"
            onClick={() => overlayInputRef.current?.click()}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Upload className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="mt-3 text-sm font-medium">Enviar do computador</p>
            <p className="mt-1 text-xs text-muted-foreground">PNG, JPG ou WebP até 12MB</p>
            <Button className="mt-3" variant="outline" size="sm">
              <ImagePlus className="mr-1.5 h-3.5 w-3.5" /> Selecionar arquivo
            </Button>
          </div>
          <input
            ref={overlayInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleOverlayFileSelect}
          />

          {/* Saved images gallery */}
          {savedImages.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">Galeria salva</p>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {savedImages.slice(0, 12).map((img) => (
                  <button
                    key={img.id}
                    onClick={() => handleSelectSaved(img)}
                    className="group relative aspect-square overflow-hidden rounded-lg border-2 border-border/50 transition-all hover:border-primary/70 hover:ring-2 hover:ring-primary/20"
                  >
                    <img src={img.file_url} alt={img.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
