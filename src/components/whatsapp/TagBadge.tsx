import { X } from 'lucide-react';

interface TagBadgeProps {
  name: string;
  color: string;
  onRemove?: () => void;
  size?: 'sm' | 'md';
}

export function TagBadge({ name, color, onRemove, size = 'sm' }: TagBadgeProps) {
  const sizeClasses = size === 'sm' ? 'text-[10px] px-1.5 py-0 h-4' : 'text-xs px-2 py-0.5 h-5';

  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full font-medium border ${sizeClasses}`}
      style={{
        backgroundColor: `${color}15`,
        color: color,
        borderColor: `${color}30`,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      {name}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-0.5 hover:opacity-70 transition-opacity"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}
