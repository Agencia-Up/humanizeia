import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useSwipeFiles, SwipeFileInsert } from '@/hooks/useSwipeFiles';
import {
  FileText,
  Plus,
  Star,
  Trash2,
  Copy,
  Search,
  Loader2,
  Pencil,
  Save,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';

const categories = [
  { value: 'geral', label: 'Geral' },
  { value: 'ecommerce', label: 'E-commerce' },
  { value: 'infoproduto', label: 'Infoproduto' },
  { value: 'saas', label: 'SaaS' },
  { value: 'servicos', label: 'Serviços' },
  { value: 'institucional', label: 'Institucional' },
];

const platformOptions = [
  { value: 'meta', label: 'Meta Ads' },
  { value: 'google', label: 'Google Ads' },
  { value: 'tiktok', label: 'TikTok Ads' },
  { value: 'outro', label: 'Outro' },
];

export function SwipeFileTab() {
  const { toast } = useToast();
  const { swipeFiles, isLoading, addSwipeFile, deleteSwipeFile, toggleFavorite, updateSwipeFile } = useSwipeFiles();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ title: string; content: string; notes: string }>({ title: '', content: '', notes: '' });

  // Form state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('geral');
  const [platform, setPlatform] = useState('meta');
  const [notes, setNotes] = useState('');

  const manualFiles = swipeFiles.filter(f => f.source !== 'auto');
  
  const filteredFiles = manualFiles.filter(file => {
    const matchesSearch = file.title.toLowerCase().includes(search.toLowerCase()) ||
      file.content.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || file.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) {
      toast({ title: 'Campos obrigatórios', description: 'Preencha título e conteúdo.', variant: 'destructive' });
      return;
    }

    const newFile: SwipeFileInsert = {
      title: title.trim(),
      content: content.trim(),
      category,
      platform,
      notes: notes.trim() || undefined,
    };

    const result = await addSwipeFile(newFile);
    if (result) {
      setTitle('');
      setContent('');
      setCategory('geral');
      setPlatform('meta');
      setNotes('');
      setDialogOpen(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copiado!', description: 'Texto copiado para a área de transferência.' });
  };

  const startEditing = (file: typeof filteredFiles[0]) => {
    setEditingId(file.id);
    setEditForm({ title: file.title, content: file.content, notes: file.notes || '' });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm({ title: '', content: '', notes: '' });
  };

  const saveEditing = async () => {
    if (!editingId) return;
    await updateSwipeFile(editingId, {
      title: editForm.title,
      content: editForm.content,
      notes: editForm.notes || undefined,
    });
    setEditingId(null);
  };

  const getCategoryColor = (cat: string) => {
    const colors: Record<string, string> = {
      ecommerce: 'bg-blue-500/20 text-blue-400',
      infoproduto: 'bg-purple-500/20 text-purple-400',
      saas: 'bg-green-500/20 text-green-400',
      servicos: 'bg-orange-500/20 text-orange-400',
      institucional: 'bg-pink-500/20 text-pink-400',
      geral: 'bg-muted text-muted-foreground',
    };
    return colors[cat] || colors.geral;
  };

  return (
    <div className="space-y-4">
      {/* Header with filters */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar no swipe file..."
                className="pl-10"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gradient-primary">
                  <Plus className="mr-2 h-4 w-4" />
                  Adicionar Copy
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Adicionar ao Swipe File</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Título *</Label>
                    <Input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Ex: Copy Viver de IA - Rafael Milagre"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Conteúdo da Copy *</Label>
                    <Textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder="Cole aqui a copy completa..."
                      rows={8}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Categoria</Label>
                      <Select value={category} onValueChange={setCategory}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {categories.map(c => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Plataforma</Label>
                      <Select value={platform} onValueChange={setPlatform}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {platformOptions.map(p => (
                            <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Notas (opcional)</Label>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Por que essa copy funciona? Qual resultado ela trouxe?"
                      rows={2}
                    />
                  </div>
                  <Button onClick={handleSubmit} className="w-full gradient-primary">
                    <Plus className="mr-2 h-4 w-4" />
                    Salvar no Swipe File
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      {/* Swipe files list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredFiles.length > 0 ? (
        <ScrollArea className="h-[600px]">
          <div className="space-y-4 pr-4">
            <AnimatePresence>
              {filteredFiles.map((file, index) => (
                <motion.div
                  key={file.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/30 transition-all">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2 flex-wrap flex-1">
                          {editingId === file.id ? (
                            <Input
                              value={editForm.title}
                              onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                              className="font-semibold"
                            />
                          ) : (
                            <>
                              <h4 className="font-semibold">{file.title}</h4>
                              {file.is_favorite && (
                                <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                              )}
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className={getCategoryColor(file.category)}>
                            {file.category}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {file.platform}
                          </Badge>
                        </div>
                      </div>
                      {editingId === file.id ? (
                        <Textarea
                          value={editForm.content}
                          onChange={(e) => setEditForm(prev => ({ ...prev, content: e.target.value }))}
                          rows={6}
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                          {file.content}
                        </p>
                      )}
                      {editingId === file.id ? (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">📝 Notas:</p>
                          <Textarea
                            value={editForm.notes}
                            onChange={(e) => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                            rows={2}
                            placeholder="Notas opcionais..."
                          />
                        </div>
                      ) : file.notes ? (
                        <div className="rounded-lg bg-muted/30 p-3">
                          <p className="text-xs font-medium text-muted-foreground">📝 Notas:</p>
                          <p className="text-sm mt-1">{file.notes}</p>
                        </div>
                      ) : null}
                      <div className="flex items-center gap-2 pt-1">
                        {editingId === file.id ? (
                          <>
                            <Button size="sm" onClick={saveEditing}>
                              <Save className="mr-1 h-3 w-3" />
                              Salvar
                            </Button>
                            <Button size="sm" variant="outline" onClick={cancelEditing}>
                              <X className="mr-1 h-3 w-3" />
                              Cancelar
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" onClick={() => startEditing(file)}>
                              <Pencil className="mr-1 h-3 w-3" />
                              Editar
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => copyToClipboard(file.content)}>
                              <Copy className="mr-1 h-3 w-3" />
                              Copiar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => toggleFavorite(file.id)}
                              className={file.is_favorite ? 'text-yellow-500' : ''}
                            >
                              <Star className={`mr-1 h-3 w-3 ${file.is_favorite ? 'fill-current' : ''}`} />
                              {file.is_favorite ? 'Favoritado' : 'Favoritar'}
                            </Button>
                            <Button size="sm" variant="outline" className="text-destructive" onClick={() => deleteSwipeFile(file.id)}>
                              <Trash2 className="mr-1 h-3 w-3" />
                              Remover
                            </Button>
                          </>
                        )}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {new Date(file.created_at).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </ScrollArea>
      ) : (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="flex h-80 flex-col items-center justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mt-4 font-semibold">Seu Swipe File está vazio</h3>
            <p className="mt-2 text-sm text-muted-foreground text-center max-w-md">
              Adicione suas melhores copies de referência aqui. Elas serão usadas como inspiração quando você gerar novas copies com IA.
            </p>
            <Button className="mt-4 gradient-primary" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Adicionar Primeira Copy
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
