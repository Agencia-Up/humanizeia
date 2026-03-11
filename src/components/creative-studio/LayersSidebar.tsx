import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, ImagePlus, GripVertical, Layers } from 'lucide-react';
import type { OverlayItem } from './ImageEditorTab';

const MAX_LAYERS = 10;

interface LayersSidebarProps {
  layers: OverlayItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onAddMore: () => void;
  onReorder: (fromId: string, toId: string) => void;
  onReorderToIndex: (fromId: string, toVisualIndex: number) => void;
}

export function LayersSidebar({
  layers,
  selectedId,
  onSelect,
  onRemove,
  onAddMore,
  onReorderToIndex,
}: LayersSidebarProps) {
  const sorted = [...layers].sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0));
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    setDragItemId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    // Semi-transparent drag
    requestAnimationFrame(() => {
      const el = itemRefs.current.get(id);
      if (el) el.style.opacity = '0.4';
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    // Restore opacity
    if (dragItemId) {
      const el = itemRefs.current.get(dragItemId);
      if (el) el.style.opacity = '1';
    }
    setDragItemId(null);
    setDropIndex(null);
  }, [dragItemId]);

  const getDropIndex = useCallback((e: React.DragEvent, visualIndex: number) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    return e.clientY < midY ? visualIndex : visualIndex + 1;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, visualIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragItemId) return;

    const dragVisualIndex = sorted.findIndex(l => l.id === dragItemId);
    const newDropIndex = getDropIndex(e, visualIndex);

    // Don't show indicator at the item's own position
    if (newDropIndex === dragVisualIndex || newDropIndex === dragVisualIndex + 1) {
      setDropIndex(null);
    } else {
      setDropIndex(newDropIndex);
    }
  }, [dragItemId, sorted, getDropIndex]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (dragItemId && dropIndex !== null) {
      onReorderToIndex(dragItemId, dropIndex);
    }
    setDragItemId(null);
    setDropIndex(null);
  }, [dragItemId, dropIndex, onReorderToIndex]);

  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // If dragging past the last item
    if (dragItemId && sorted.length > 0) {
      const lastEl = itemRefs.current.get(sorted[sorted.length - 1].id);
      if (lastEl) {
        const rect = lastEl.getBoundingClientRect();
        if (e.clientY > rect.bottom) {
          const dragVisualIndex = sorted.findIndex(l => l.id === dragItemId);
          if (sorted.length !== dragVisualIndex + 1) {
            setDropIndex(sorted.length);
          } else {
            setDropIndex(null);
          }
        }
      }
    }
  }, [dragItemId, sorted]);

  const DropIndicator = () => (
    <div className="flex items-center gap-1.5 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 p-1.5 mb-1">
      <div className="h-10 w-10 flex-shrink-0 rounded-md bg-primary/10 border border-dashed border-primary/30" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="h-2.5 w-16 rounded bg-primary/15" />
        <div className="h-2 w-10 rounded bg-primary/10" />
      </div>
    </div>
  );

  return (
    <div className="flex w-52 flex-col self-stretch border-l border-border/50 bg-muted/30">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Camadas</span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onAddMore} title="Adicionar imagem" disabled={layers.length >= MAX_LAYERS}>
          <ImagePlus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Layer list */}
      <ScrollArea className="flex-1">
        <div
          className="space-y-0 p-2"
          onDragOver={handleContainerDragOver}
          onDrop={handleDrop}
        >
          {sorted.map((layer, visualIndex) => {
            const isSelected = selectedId === layer.id;
            const isDragging = dragItemId === layer.id;

            return (
              <div key={layer.id}>
                {/* Drop indicator before this item */}
                {dropIndex === visualIndex && <DropIndicator />}

                <div
                  ref={(el) => { if (el) itemRefs.current.set(layer.id, el); }}
                  draggable
                  onDragStart={(e) => handleDragStart(e, layer.id)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, visualIndex)}
                  className={`group flex items-center gap-1.5 rounded-lg p-1.5 mb-1 transition-all cursor-grab active:cursor-grabbing ${
                    isSelected
                      ? 'bg-primary/10 ring-1 ring-primary/30'
                      : 'hover:bg-muted/60'
                  } ${isDragging ? 'opacity-40' : ''}`}
                  onClick={() => onSelect(isSelected ? null : layer.id)}
                >
                  {/* Drag handle */}
                  <GripVertical className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground" />

                  {/* Thumbnail */}
                  <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-md border border-border/50">
                    <img
                      src={layer.image}
                      alt={`Camada ${visualIndex + 1}`}
                      className="h-full w-full object-cover pointer-events-none"
                      draggable={false}
                    />
                  </div>

                  {/* Info */}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[11px] font-medium">
                      Camada {visualIndex + 1}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {visualIndex === 0 ? 'Frente' : visualIndex === sorted.length - 1 ? 'Trás' : `z: ${layer.zIndex}`}
                    </span>
                  </div>

                  {/* Delete */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 flex-shrink-0 text-destructive opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={(e) => { e.stopPropagation(); onRemove(layer.id); }}
                    title="Remover"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>

                {/* Drop indicator after last item */}
                {visualIndex === sorted.length - 1 && dropIndex === sorted.length && <DropIndicator />}
              </div>
            );
          })}

          {layers.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Layers className="h-6 w-6 text-muted-foreground/40" />
              <p className="text-[11px] text-muted-foreground">Nenhuma camada</p>
              <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={onAddMore}>
                <ImagePlus className="mr-1 h-3 w-3" /> Adicionar
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      {layers.length > 0 && (
        <div className="border-t border-border/50 px-3 py-2">
          <p className="text-[10px] text-muted-foreground text-center">
            {layers.length}/{MAX_LAYERS} · arraste para reordenar
          </p>
        </div>
      )}
    </div>
  );
}
