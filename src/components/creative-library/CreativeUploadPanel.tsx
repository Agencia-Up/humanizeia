import { useState, useRef, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Upload, Search, Grid, List, Image, Video, Trash2, Star, StarOff,
  FolderOpen, Heart, Filter, Plus, Loader2, Eye, FileImage, Film
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useCreativeUploads, CreativeUpload } from '@/hooks/useCreativeUploads';
import { Skeleton } from '@/components/ui/skeleton';

const CATEGORIES = [
  { value: 'geral', label: 'Geral' },
  { value: 'produto', label: 'Produto' },
  { value: 'lifestyle', label: 'Lifestyle' },
  { value: 'prova_social', label: 'Prova Social' },
  { value: 'depoimento', label: 'Depoimento' },
  { value: 'oferta', label: 'Oferta' },
  { value: 'institucional', label: 'Institucional' },
  { value: 'carrossel', label: 'Carrossel' },
  { value: 'stories', label: 'Stories / Reels' },
];

export function CreativeUploadPanel() {
  const {
    uploads, isLoading, isUploading, uploadFile, deleteUpload, toggleFavorite
  } = useCreativeUploads();

  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [previewItem, setPreviewItem] = useState<CreativeUpload | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadCategory, setUploadCategory] = useState('geral');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = uploads.filter(u => {
    if (search && !u.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter !== 'all' && u.file_type !== typeFilter) return false;
    if (categoryFilter !== 'all' && u.category !== categoryFilter) return false;
    return true;
  });

  const stats = {
    total: uploads.length,
    images: uploads.filter(u => u.file_type === 'image').length,
    videos: uploads.filter(u => u.file_type === 'video').length,
    favorites: uploads.filter(u => u.is_favorite).length,
  };

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setSelectedFiles(files);
      if (files.length === 1) {
        setUploadName(files[0].name.replace(/\.[^.]+$/, ''));
      }
      setShowUploadDialog(true);
    }
  };

  const handleUpload = async () => {
    const tags = uploadTags.split(',').map(t => t.trim()).filter(Boolean);
    for (const file of selectedFiles) {
      await uploadFile(file, {
        name: selectedFiles.length === 1 ? uploadName : undefined,
        category: uploadCategory,
        tags,
        description: uploadDescription || undefined,
      });
    }
    setShowUploadDialog(false);
    setSelectedFiles([]);
    setUploadName('');
    setUploadCategory('geral');
    setUploadDescription('');
    setUploadTags('');
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setSelectedFiles(files);
      if (files.length === 1) setUploadName(files[0].name.replace(/\.[^.]+$/, ''));
      setShowUploadDialog(true);
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card className="border-border/50 bg-card/50"><CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/20"><FolderOpen className="h-5 w-5 text-primary" /></div>
          <div><p className="text-2xl font-bold">{stats.total}</p><p className="text-xs text-muted-foreground">Total</p></div>
        </CardContent></Card>
        <Card className="border-border/50 bg-card/50"><CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/20"><FileImage className="h-5 w-5 text-blue-500" /></div>
          <div><p className="text-2xl font-bold">{stats.images}</p><p className="text-xs text-muted-foreground">Imagens</p></div>
        </CardContent></Card>
        <Card className="border-border/50 bg-card/50"><CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/20"><Film className="h-5 w-5 text-purple-500" /></div>
          <div><p className="text-2xl font-bold">{stats.videos}</p><p className="text-xs text-muted-foreground">Vídeos</p></div>
        </CardContent></Card>
        <Card className="border-border/50 bg-card/50"><CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/20"><Heart className="h-5 w-5 text-red-500" /></div>
          <div><p className="text-2xl font-bold">{stats.favorites}</p><p className="text-xs text-muted-foreground">Favoritos</p></div>
        </CardContent></Card>
      </div>

      {/* Upload area + Filters */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="p-4 space-y-4">
          {/* Drop zone */}
          <div
            className="border-2 border-dashed border-border/60 rounded-xl p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium text-foreground">Arraste arquivos aqui ou clique para enviar</p>
            <p className="text-xs text-muted-foreground mt-1">
              Imagens (PNG, JPG, WebP, GIF até 10MB) • Vídeos (MP4, MOV, WebM até 50MB)
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
              className="hidden"
              onChange={handleFilesSelected}
            />
          </div>

          {/* Filters row */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar criativos..." className="pl-10" />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="image">Imagens</SelectItem>
                <SelectItem value="video">Vídeos</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-1 rounded-lg border border-border p-1">
              <Button size="icon" variant={view === 'grid' ? 'default' : 'ghost'} className="h-8 w-8" onClick={() => setView('grid')}><Grid className="h-4 w-4" /></Button>
              <Button size="icon" variant={view === 'list' ? 'default' : 'ghost'} className="h-8 w-8" onClick={() => setView('list')}><List className="h-4 w-4" /></Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grid */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-lg" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-border/50 bg-card/50">
          <CardContent className="flex flex-col items-center gap-3 py-16">
            <Image className="h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">
              {uploads.length === 0 ? 'Nenhum criativo enviado ainda. Faça seu primeiro upload!' : 'Nenhum criativo encontrado.'}
            </p>
            {uploads.length === 0 && (
              <Button onClick={() => fileInputRef.current?.click()} className="gap-2">
                <Plus className="h-4 w-4" /> Enviar Criativo
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className={view === 'grid' ? 'grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'space-y-3'}>
          {filtered.map((item, index) => (
            <motion.div key={item.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: index * 0.03 }}>
              <Card className="group relative border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden transition-all hover:border-primary/30 hover:shadow-lg">
                {item.file_type === 'image' && item.file_url && (
                  <div className="relative aspect-square cursor-pointer" onClick={() => setPreviewItem(item)}>
                    <img src={item.file_url} alt={item.name} loading="lazy" className="h-full w-full object-cover" />
                    {/* Overlay buttons */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                      <Button size="icon" variant="secondary" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); setPreviewItem(item); }}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="secondary" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); toggleFavorite(item.id); }}>
                        {item.is_favorite ? <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" /> : <StarOff className="h-4 w-4" />}
                      </Button>
                      <Button size="icon" variant="destructive" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); deleteUpload(item.id); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
                {item.file_type === 'video' && (
                  <div className="relative aspect-square bg-muted flex items-center justify-center cursor-pointer" onClick={() => setPreviewItem(item)}>
                    <Video className="h-12 w-12 text-muted-foreground" />
                    <Badge className="absolute top-2 left-2 bg-purple-500/80 text-white text-xs">Vídeo</Badge>
                  </div>
                )}
                <CardContent className="p-3 space-y-1.5">
                  <p className="font-medium truncate text-sm">{item.name}</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="secondary" className="text-xs capitalize">{item.category}</Badge>
                    {item.file_type === 'image' && <Badge variant="outline" className="text-xs">{item.dimensions || 'Imagem'}</Badge>}
                    {item.ai_score && (
                      <Badge className={`text-xs ${item.ai_score >= 80 ? 'bg-green-500/20 text-green-400' : item.ai_score >= 50 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                        Score: {item.ai_score}
                      </Badge>
                    )}
                  </div>
                  {item.tags && item.tags.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {item.tags.slice(0, 3).map(tag => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{tag}</span>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Upload Dialog */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Upload className="h-5 w-5 text-primary" /> Enviar Criativos</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {selectedFiles.length} arquivo{selectedFiles.length > 1 ? 's' : ''} selecionado{selectedFiles.length > 1 ? 's' : ''}
            </p>
            {selectedFiles.length === 1 && (
              <div>
                <label className="text-sm font-medium">Nome</label>
                <Input value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder="Nome do criativo" />
              </div>
            )}
            <div>
              <label className="text-sm font-medium">Categoria</label>
              <Select value={uploadCategory} onValueChange={setUploadCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Tags (separadas por vírgula)</label>
              <Input value={uploadTags} onChange={(e) => setUploadTags(e.target.value)} placeholder="produto, oferta, black friday" />
            </div>
            <div>
              <label className="text-sm font-medium">Descrição (opcional)</label>
              <Textarea value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} placeholder="Descreva o criativo..." rows={2} />
            </div>
            <Button onClick={handleUpload} disabled={isUploading} className="w-full gap-2">
              {isUploading ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando...</> : <><Upload className="h-4 w-4" /> Enviar</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={!!previewItem} onOpenChange={(open) => !open && setPreviewItem(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0">
          {previewItem && (
            <div>
              {previewItem.file_type === 'image' && (
                <img src={previewItem.file_url} alt={previewItem.name} className="w-full max-h-[60vh] object-contain bg-muted/20" />
              )}
              {previewItem.file_type === 'video' && (
                <video src={previewItem.file_url} controls className="w-full max-h-[60vh]" />
              )}
              <div className="p-6 space-y-3">
                <h2 className="text-lg font-semibold">{previewItem.name}</h2>
                <div className="flex gap-2 flex-wrap">
                  <Badge variant="secondary" className="capitalize">{previewItem.category}</Badge>
                  <Badge variant="outline">{previewItem.file_type}</Badge>
                  {previewItem.dimensions && <Badge variant="outline">{previewItem.dimensions}</Badge>}
                  {previewItem.file_size_bytes && (
                    <Badge variant="outline">{(previewItem.file_size_bytes / 1024 / 1024).toFixed(1)} MB</Badge>
                  )}
                </div>
                {previewItem.description && <p className="text-sm text-muted-foreground">{previewItem.description}</p>}
                {previewItem.tags && previewItem.tags.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {previewItem.tags.map(tag => <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>)}
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="gap-1.5" onClick={() => toggleFavorite(previewItem.id)}>
                    {previewItem.is_favorite ? <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" /> : <StarOff className="h-4 w-4" />}
                    {previewItem.is_favorite ? 'Favoritado' : 'Favoritar'}
                  </Button>
                  <Button variant="destructive" className="gap-1.5" onClick={() => { deleteUpload(previewItem.id); setPreviewItem(null); }}>
                    <Trash2 className="h-4 w-4" /> Remover
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
