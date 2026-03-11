import { useRef, useState, useCallback, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface TextLayer {
  id: string;
  content: string;
  font: string;
  color: string;
  size: number;
  position: { x: number; y: number };
  scale: number; // width in % of container
}

interface TextOverlayLayerProps {
  layer: TextLayer;
  selected: boolean;
  onSelect: (id: string) => void;
  onUpdate: (id: string, updates: Partial<TextLayer>) => void;
  onDelete: (id: string) => void;
  containerRef: React.RefObject<HTMLDivElement>;
  fontOptions: { value: string; label: string }[];
  onInteractionChange?: (interacting: boolean) => void;
}

type HandleType = 'tl' | 'tr' | 'bl' | 'br';

export function TextOverlayLayer({
  layer,
  selected,
  onSelect,
  onUpdate,
  onDelete,
  containerRef,
  fontOptions,
  onInteractionChange,
}: TextOverlayLayerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; posX: number; posY: number } | null>(null);
  const resizeStartRef = useRef<{ mouseX: number; mouseY: number; scale: number; handle: HandleType; posX: number; posY: number } | null>(null);
  const [isEditingText, setIsEditingText] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(layer.id);
    setIsDragging(true);
    onInteractionChange?.(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: layer.position.x,
      posY: layer.position.y,
    };
  }, [layer.position, layer.id, onSelect, onInteractionChange]);

  // Resize
  const handleResizeStart = useCallback((e: React.MouseEvent, handle: HandleType) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    onInteractionChange?.(true);
    resizeStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      scale: layer.scale,
      handle,
      posX: layer.position.x,
      posY: layer.position.y,
    };
  }, [layer.scale, layer.position, onInteractionChange]);

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      if (isDragging && dragStartRef.current) {
        const deltaX = ((e.clientX - dragStartRef.current.mouseX) / rect.width) * 100;
        const deltaY = ((e.clientY - dragStartRef.current.mouseY) / rect.height) * 100;
        onUpdate(layer.id, {
          position: {
            x: dragStartRef.current.posX + deltaX,
            y: dragStartRef.current.posY + deltaY,
          },
        });
      }

      if (isResizing && resizeStartRef.current) {
        const r = resizeStartRef.current;
        const deltaX = e.clientX - r.mouseX;
        const deltaScalePx = (deltaX / rect.width) * 100;
        const dir = r.handle === 'tl' || r.handle === 'bl' ? -1 : 1;
        const newScale = Math.max(5, r.scale + deltaScalePx * dir);
        const scaleDiff = newScale - r.scale;

        let newX = r.posX;
        let newY = r.posY;

        if (r.handle === 'tl') {
          newX = r.posX - scaleDiff;
          newY = r.posY - scaleDiff;
        } else if (r.handle === 'tr') {
          newY = r.posY - scaleDiff;
        } else if (r.handle === 'bl') {
          newX = r.posX - scaleDiff;
        }

        onUpdate(layer.id, {
          scale: Math.round(newScale),
          position: { x: newX, y: newY },
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      onInteractionChange?.(false);
      dragStartRef.current = null;
      resizeStartRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, containerRef, onUpdate, layer.id, onInteractionChange]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditingText && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditingText]);

  const handleStyle = 'absolute h-3 w-3 rounded-full border-2 border-primary bg-background shadow-md z-20';
  const handles: { type: HandleType; className: string; cursor: string }[] = [
    { type: 'tl', className: `${handleStyle} -left-1.5 -top-1.5`, cursor: 'nwse-resize' },
    { type: 'tr', className: `${handleStyle} -right-1.5 -top-1.5`, cursor: 'nesw-resize' },
    { type: 'bl', className: `${handleStyle} -bottom-1.5 -left-1.5`, cursor: 'nesw-resize' },
    { type: 'br', className: `${handleStyle} -bottom-1.5 -right-1.5`, cursor: 'nwse-resize' },
  ];

  // Calculate font size based on scale — use percentage of container width via JS
  const [computedFontSize, setComputedFontSize] = useState(16);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // fontSize = scale% of container width, scaled down to reasonable text size
    const update = () => {
      const boxWidth = el.clientWidth * (layer.scale / 100);
      // Font size ~20% of box width as baseline, clamped
      setComputedFontSize(Math.max(8, boxWidth * 0.25));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, layer.scale]);

  return (
    <>
      {/* Main text layer */}
      <div
        className="absolute z-10"
        style={{
          left: `${layer.position.x}%`,
          top: `${layer.position.y}%`,
          width: `${layer.scale}%`,
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
        }}
        onMouseDown={handleMouseDown}
        onClick={(e) => { e.stopPropagation(); onSelect(layer.id); }}
      >
        {/* Border */}
        <div
          className={`pointer-events-none absolute inset-0 rounded border-2 ${selected ? 'border-solid border-primary' : 'border-dashed border-primary/40'}`}
          style={{ boxShadow: selected ? '0 0 0 1px hsl(var(--background) / 0.5)' : 'none' }}
        />

        {/* Text content */}
        <div className="pointer-events-none px-1 py-0.5">
          <span
            style={{
              fontFamily: layer.font,
              fontSize: `${computedFontSize}px`,
              color: layer.color,
              whiteSpace: 'nowrap',
              lineHeight: 1.2,
              display: 'block',
            }}
          >
            {layer.content || 'Texto'}
          </span>
        </div>

        {/* Resize handles - only when selected */}
        {selected && handles.map(({ type, className, cursor }) => (
          <div
            key={type}
            className={className}
            style={{ cursor, pointerEvents: 'auto' }}
            onMouseDown={(e) => handleResizeStart(e, type)}
          />
        ))}
      </div>

      {/* Floating toolbar - rendered outside the draggable area */}
      {selected && (
        <div
          className="absolute z-30 flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/90 px-2 py-1.5 shadow-lg backdrop-blur-md"
          style={{
            left: `${layer.position.x}%`,
            top: `${Math.max(0, layer.position.y - 8)}%`,
            transform: 'translateY(-100%)',
            minWidth: '200px',
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Inline text edit */}
          {isEditingText ? (
            <input
              ref={inputRef}
              type="text"
              value={layer.content}
              onChange={(e) => onUpdate(layer.id, { content: e.target.value })}
              onBlur={() => setIsEditingText(false)}
              onKeyDown={(e) => { if (e.key === 'Enter') setIsEditingText(false); }}
              className="h-6 w-24 min-w-0 rounded border border-input bg-background px-1.5 text-xs outline-none"
            />
          ) : (
            <button
              onClick={() => setIsEditingText(true)}
              className="max-w-[80px] truncate rounded px-1.5 py-0.5 text-xs hover:bg-accent"
              title={layer.content}
            >
              {layer.content || 'Texto'}
            </button>
          )}

          {/* Font select */}
          <Select
            value={layer.font}
            onValueChange={(v) => onUpdate(layer.id, { font: v })}
          >
            <SelectTrigger className="h-6 w-20 border-none bg-transparent px-1 text-[10px] shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fontOptions.map(f => (
                <SelectItem key={f.value} value={f.value}>
                  <span style={{ fontFamily: f.value }} className="text-xs">{f.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Color picker */}
          <div className="relative">
            <input
              type="color"
              value={layer.color}
              onChange={(e) => onUpdate(layer.id, { color: e.target.value })}
              className="absolute inset-0 h-5 w-5 cursor-pointer opacity-0"
            />
            <div
              className="h-5 w-5 rounded-full border border-border/60 shadow-sm"
              style={{ backgroundColor: layer.color }}
            />
          </div>

          {/* Delete */}
          <button
            onClick={() => onDelete(layer.id)}
            className="ml-0.5 flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            title="Excluir"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}
    </>
  );
}
