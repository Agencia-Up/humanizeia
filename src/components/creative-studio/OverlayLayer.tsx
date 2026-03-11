import { useRef, useState, useCallback, useEffect } from 'react';

interface OverlayPosition {
  x: number;
  y: number;
}

interface OverlayLayerProps {
  overlayImage: string;
  scale: number;
  position: OverlayPosition;
  onPositionChange: (pos: OverlayPosition) => void;
  onScaleChange: (scale: number) => void;
  containerRef: React.RefObject<HTMLDivElement>;
  onInteractionChange?: (interacting: boolean) => void;
  style?: React.CSSProperties;
}

type HandleType = 'tl' | 'tr' | 'bl' | 'br';

export function OverlayLayer({
  overlayImage,
  scale,
  position,
  onPositionChange,
  onScaleChange,
  containerRef,
  onInteractionChange,
  style,
}: OverlayLayerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; posX: number; posY: number } | null>(null);
  const resizeStartRef = useRef<{ mouseX: number; mouseY: number; scale: number; handle: HandleType; posX: number; posY: number } | null>(null);

  // Drag logic
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    onInteractionChange?.(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: position.x,
      posY: position.y,
    };
  }, [position]);

  // Resize logic
  const handleResizeStart = useCallback((e: React.MouseEvent, handle: HandleType) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    onInteractionChange?.(true);
    resizeStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      scale,
      handle,
      posX: position.x,
      posY: position.y,
    };
  }, [scale, position]);

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      if (isDragging && dragStartRef.current) {
        const deltaX = ((e.clientX - dragStartRef.current.mouseX) / rect.width) * 100;
        const deltaY = ((e.clientY - dragStartRef.current.mouseY) / rect.height) * 100;
        const newX = dragStartRef.current.posX + deltaX;
        const newY = dragStartRef.current.posY + deltaY;
        onPositionChange({ x: newX, y: newY });
      }

      if (isResizing && resizeStartRef.current) {
        const r = resizeStartRef.current;
        const deltaX = e.clientX - r.mouseX;
        const deltaScalePx = (deltaX / rect.width) * 100;

        // For left handles, invert direction
        const dir = r.handle === 'tl' || r.handle === 'bl' ? -1 : 1;
        const newScale = Math.max(5, r.scale + deltaScalePx * dir);
        const scaleDiff = newScale - r.scale;

        // Anchor the opposite corner by adjusting position
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
        // br: position stays the same

        onScaleChange(Math.round(newScale));
        onPositionChange({ x: newX, y: newY });
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
  }, [isDragging, isResizing, containerRef, onPositionChange, onScaleChange, scale]);

  const handleStyle = 'absolute h-3 w-3 rounded-full border-2 border-primary bg-background shadow-md z-20';
  const handles: { type: HandleType; className: string; cursor: string }[] = [
    { type: 'tl', className: `${handleStyle} -left-1.5 -top-1.5`, cursor: 'nwse-resize' },
    { type: 'tr', className: `${handleStyle} -right-1.5 -top-1.5`, cursor: 'nesw-resize' },
    { type: 'bl', className: `${handleStyle} -bottom-1.5 -left-1.5`, cursor: 'nesw-resize' },
    { type: 'br', className: `${handleStyle} -bottom-1.5 -right-1.5`, cursor: 'nwse-resize' },
  ];

  return (
    <div
      className="absolute"
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        width: `${scale}%`,
        cursor: isDragging ? 'grabbing' : 'grab',
        ...style,
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Border frame */}
      <div
        className="pointer-events-none absolute inset-0 rounded border-2 border-dashed border-primary"
        style={{ boxShadow: '0 0 0 1px hsl(var(--background) / 0.5)' }}
      />

      {/* Image */}
      <img
        src={overlayImage}
        alt="Overlay"
        className="pointer-events-none h-auto w-full rounded opacity-95"
        draggable={false}
      />

      {/* Resize handles */}
      {handles.map(({ type, className, cursor }) => (
        <div
          key={type}
          className={className}
          style={{ cursor, pointerEvents: 'auto' }}
          onMouseDown={(e) => handleResizeStart(e, type)}
        />
      ))}
    </div>
  );
}
