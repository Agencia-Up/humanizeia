import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { BookmarkPlus, Loader2 } from 'lucide-react';

const categories = [
  { value: 'geral', label: 'Geral' },
  { value: 'ecommerce', label: 'E-commerce' },
  { value: 'infoproduto', label: 'Infoproduto' },
  { value: 'saas', label: 'SaaS' },
  { value: 'servicos', label: 'Serviços' },
  { value: 'institucional', label: 'Institucional' },
];

interface SaveToSwipeFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  content: string;
  platform: string;
  onSave: (data: { title: string; content: string; category: string; platform: string; notes?: string }) => Promise<any>;
}

export function SaveToSwipeFileDialog({ open, onOpenChange, title, content, platform, onSave }: SaveToSwipeFileDialogProps) {
  const [category, setCategory] = useState('geral');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const result = await onSave({
        title,
        content,
        category,
        platform,
        notes: notes.trim() || undefined,
      });
      if (result) {
        setCategory('geral');
        setNotes('');
        onOpenChange(false);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookmarkPlus className="h-5 w-5" />
            Salvar no Swipe File
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg bg-muted/30 p-3">
            <p className="text-sm font-medium truncate">{title}</p>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{content}</p>
          </div>
          <div className="space-y-2">
            <Label>Categoria</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notas (opcional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Por que essa copy é boa? Qual resultado trouxe?"
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={isSaving} className="gradient-primary">
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BookmarkPlus className="mr-2 h-4 w-4" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
