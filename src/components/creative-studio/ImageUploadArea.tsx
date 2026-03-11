import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Upload, ImagePlus, Image as ImageIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface SavedImage {
  id: string;
  file_url: string;
  name: string;
}

interface ImageUploadAreaProps {
  onFileSelect: (file: File) => void;
  onSavedImageSelect?: (image: SavedImage) => void;
  savedImages?: SavedImage[];
  accept?: string;
  maxSizeMB?: number;
  title?: string;
  subtitle?: string;
}

export function ImageUploadArea({
  onFileSelect,
  onSavedImageSelect,
  savedImages = [],
  accept = 'image/png,image/jpeg,image/webp',
  maxSizeMB = 12,
  title = 'Envie sua imagem',
  subtitle,
}: ImageUploadAreaProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > maxSizeMB * 1024 * 1024) return;
    onFileSelect(file);
  }, [onFileSelect, maxSizeMB]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-5"
    >
      {/* Drop zone */}
      <div
        className={cn(
          'group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 transition-all duration-200',
          isDragOver
            ? 'border-primary bg-primary/5 shadow-[0_0_0_4px_hsl(var(--primary)/0.1)]'
            : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30'
        )}
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <div className={cn(
          'flex h-14 w-14 items-center justify-center rounded-full transition-colors duration-200',
          isDragOver ? 'bg-primary/10' : 'bg-muted'
        )}>
          <Upload className={cn(
            'h-6 w-6 transition-colors duration-200',
            isDragOver ? 'text-primary' : 'text-muted-foreground'
          )} />
        </div>

        <h3 className="mt-3 text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-center text-xs text-muted-foreground">
          {subtitle || `Arraste e solte ou clique para selecionar • PNG, JPG, WebP até ${maxSizeMB}MB`}
        </p>

        <Button className="mt-3" variant="outline" size="sm" type="button" onClick={(e) => e.stopPropagation()}>
          <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
          Selecionar Arquivo
        </Button>

        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={handleInputChange}
        />
      </div>

      {/* Saved images */}
      {savedImages.length > 0 && onSavedImageSelect && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-medium text-muted-foreground">
              Ou selecione uma imagem salva
            </p>
          </div>
          <ScrollArea className="w-full" style={{ maxHeight: '140px' }}>
            <div className="flex flex-wrap gap-2 pb-1">
              {savedImages.map((img) => (
                <button
                  key={img.id}
                  onClick={() => onSavedImageSelect(img)}
                  className="group relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border-2 border-border/50 transition-all hover:border-primary/70 hover:ring-2 hover:ring-primary/20"
                  title={img.name}
                >
                  <img
                    src={img.file_url}
                    alt={img.name}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
            <ScrollBar orientation="vertical" />
          </ScrollArea>
        </div>
      )}
    </motion.div>
  );
}
