import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TagBadge } from './TagBadge';
import { Tag, Plus, Check } from 'lucide-react';

interface WaTag {
  id: string;
  name: string;
  color: string;
}

interface TagSelectorProps {
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  trigger?: React.ReactNode;
}

const TAG_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
];

export function TagSelector({ selectedTags, onTagsChange, trigger }: TagSelectorProps) {
  const { user } = useAuth();
  const { isSeller, seller, loading: sellerLoading } = useSellerProfile(user?.id);
  const effectiveUserId = useMemo(() => {
    if (sellerLoading) return null;
    if (isSeller && seller?.user_id) return seller.user_id;
    return user?.id || null;
  }, [sellerLoading, isSeller, seller, user]);
  const [tags, setTags] = useState<WaTag[]>([]);
  const [open, setOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (effectiveUserId && open) fetchTags();
  }, [effectiveUserId, open]);

  const fetchTags = async () => {
    if (!effectiveUserId) return;
    const { data } = await supabase
      .from('wa_tags')
      .select('*')
      .eq('user_id', effectiveUserId)
      .order('name');
    if (data) setTags(data as unknown as WaTag[]);
  };

  const createTag = async () => {
    if (!effectiveUserId || !newTagName.trim()) return;
    setIsCreating(true);
    const color = TAG_COLORS[tags.length % TAG_COLORS.length];
    const { data, error } = await supabase
      .from('wa_tags')
      .insert({ user_id: effectiveUserId, name: newTagName.trim(), color })
      .select()
      .single();
    if (!error && data) {
      const newTag = data as unknown as WaTag;
      setTags(prev => [...prev, newTag]);
      onTagsChange([...selectedTags, newTag.name]);
      setNewTagName('');
    }
    setIsCreating(false);
  };

  const toggleTag = (tagName: string) => {
    if (selectedTags.includes(tagName)) {
      onTagsChange(selectedTags.filter(t => t !== tagName));
    } else {
      onTagsChange([...selectedTags, tagName]);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Tag className="h-3.5 w-3.5" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <p className="text-xs font-medium text-muted-foreground px-2 mb-2">Etiquetas</p>

        <div className="space-y-0.5 max-h-40 overflow-y-auto">
          {tags.map(tag => (
            <button
              key={tag.id}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-muted/50 transition-colors text-left"
              onClick={() => toggleTag(tag.name)}
            >
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
              <span className="text-sm flex-1 truncate">{tag.name}</span>
              {selectedTags.includes(tag.name) && (
                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
              )}
            </button>
          ))}
        </div>

        <div className="border-t mt-2 pt-2 flex gap-1">
          <Input
            placeholder="Nova etiqueta..."
            className="h-7 text-xs"
            value={newTagName}
            onChange={e => setNewTagName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createTag(); }}
          />
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={createTag} disabled={isCreating || !newTagName.trim()}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
