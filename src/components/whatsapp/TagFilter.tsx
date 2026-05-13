import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Filter, Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface WaTag {
  id: string;
  name: string;
  color: string;
}

interface TagFilterProps {
  activeTags: string[];
  onFilterChange: (tags: string[]) => void;
}

export function TagFilter({ activeTags, onFilterChange }: TagFilterProps) {
  const { user } = useAuth();
  const { isSeller, seller, loading: sellerLoading } = useSellerProfile(user?.id);
  const effectiveUserId = useMemo(() => {
    if (sellerLoading) return null;
    if (isSeller && seller?.user_id) return seller.user_id;
    return user?.id || null;
  }, [sellerLoading, isSeller, seller, user]);
  const [tags, setTags] = useState<WaTag[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (effectiveUserId && open) {
      supabase
        .from('wa_tags')
        .select('*')
        .eq('user_id', effectiveUserId)
        .order('name')
        .then(({ data }) => {
          if (data) setTags(data as unknown as WaTag[]);
        });
    }
  }, [effectiveUserId, open]);

  const toggleTag = (tagName: string) => {
    if (activeTags.includes(tagName)) {
      onFilterChange(activeTags.filter(t => t !== tagName));
    } else {
      onFilterChange([...activeTags, tagName]);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Filter className="h-3.5 w-3.5" />
          Etiquetas
          {activeTags.length > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              {activeTags.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" align="start">
        {tags.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">Nenhuma etiqueta criada</p>
        ) : (
          <div className="space-y-0.5">
            {tags.map(tag => (
              <button
                key={tag.id}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-muted/50 transition-colors text-left"
                onClick={() => toggleTag(tag.name)}
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                <span className="text-sm flex-1 truncate">{tag.name}</span>
                {activeTags.includes(tag.name) && (
                  <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                )}
              </button>
            ))}
            {activeTags.length > 0 && (
              <button
                className="w-full text-xs text-muted-foreground hover:text-foreground text-center py-1 border-t mt-1"
                onClick={() => onFilterChange([])}
              >
                Limpar filtros
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
