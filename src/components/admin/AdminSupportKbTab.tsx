/**
 * Base de Conhecimento do Chat de Suporte — só superadmin (a aba vive dentro de
 * /administracao, que já é gated por AdminRoute + profiles.is_superadmin; a RLS
 * das tabelas repete o gate, então o front não é a única defesa).
 *
 * DUAS FONTES, DE PROPÓSITO:
 *  - Artigos: tabela nova (support_knowledge_articles). É o texto que a IA lê.
 *  - Vídeos: vivem no /treinamento (training_videos) e são cadastrados LÁ. Aqui
 *    a gente só ENRIQUECE com as palavras que a pessoa usaria pra pedir aquele
 *    vídeo. Catálogo novo obrigaria cadastrar tudo duas vezes e as listas
 *    divergiriam na primeira semana.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { descricaoErro } from '@/lib/erroAmigavel';
import {
  BookOpen, Plus, Loader2, Info, PlayCircle, Search, Save, ExternalLink,
} from 'lucide-react';

interface Categoria { id: string; name: string; slug: string }
interface Artigo {
  id: string; category_id: string | null; title: string; slug: string;
  summary: string | null; content: string; keywords: string[];
  related_questions: string[]; status: string; audience: string;
  agent_scope: string; priority: number;
}
interface Video {
  id: string; title: string; description: string | null; video_url: string;
  keywords: string[]; support_category_slug: string | null;
}

const VAZIO: Partial<Artigo> = {
  title: '', slug: '', summary: '', content: '', keywords: [],
  related_questions: [], status: 'draft', audience: 'all', agent_scope: 'all',
  priority: 0, category_id: null,
};

/** Slug a partir do título — sem acento, sem símbolo. */
function gerarSlug(t: string) {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}
const paraArray = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);

export default function AdminSupportKbTab() {
  const { toast } = useToast();
  const [aba, setAba] = useState<'artigos' | 'videos'>('artigos');
  const [cats, setCats] = useState<Categoria[]>([]);
  const [artigos, setArtigos] = useState<Artigo[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [edit, setEdit] = useState<Partial<Artigo> | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [c, a, v] = await Promise.all([
        supabase.from('support_knowledge_categories')
          .select('id, name, slug').eq('is_active', true).order('sort_order'),
        supabase.from('support_knowledge_articles')
          .select('id, category_id, title, slug, summary, content, keywords, related_questions, status, audience, agent_scope, priority')
          .order('status').order('title'),
        supabase.from('training_videos')
          .select('id, title, description, video_url, keywords, support_category_slug')
          .eq('is_global', true).order('sort_order'),
      ]);
      setCats((c.data ?? []) as any);
      setArtigos((a.data ?? []) as any);
      setVideos((v.data ?? []) as any);
    } catch (e: any) {
      toast({ title: 'Erro', description: descricaoErro(e), variant: 'destructive' });
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { carregar(); }, [carregar]);

  const salvarArtigo = async () => {
    if (!edit?.title?.trim() || !edit?.content?.trim()) {
      toast({ title: 'Título e conteúdo são obrigatórios', variant: 'destructive' });
      return;
    }
    setSalvando(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const row = {
        title: edit.title!.trim(),
        slug: (edit.slug?.trim() || gerarSlug(edit.title!)),
        summary: edit.summary?.trim() || null,
        content: edit.content!.trim(),
        keywords: edit.keywords ?? [],
        related_questions: edit.related_questions ?? [],
        status: edit.status ?? 'draft',
        audience: edit.audience ?? 'all',
        agent_scope: edit.agent_scope ?? 'all',
        priority: Number(edit.priority ?? 0),
        category_id: edit.category_id || null,
        updated_by: u?.user?.id ?? null,
      };
      const res = edit.id
        ? await supabase.from('support_knowledge_articles').update(row).eq('id', edit.id)
        : await supabase.from('support_knowledge_articles')
            .insert({ ...row, created_by: u?.user?.id ?? null });
      if (res.error) throw res.error;
      toast({ title: '✅ Artigo salvo' });
      setEdit(null);
      carregar();
    } catch (e: any) {
      toast({ title: 'Erro ao salvar', description: descricaoErro(e), variant: 'destructive' });
    } finally { setSalvando(false); }
  };

  const salvarVideo = async (v: Video, keywords: string[], slug: string | null) => {
    try {
      const { error } = await supabase.from('training_videos')
        .update({ keywords, support_category_slug: slug }).eq('id', v.id);
      if (error) throw error;
      toast({ title: '✅ Vídeo atualizado' });
      carregar();
    } catch (e: any) {
      toast({ title: 'Erro', description: descricaoErro(e), variant: 'destructive' });
    }
  };

  const filtrados = artigos.filter(a =>
    !busca || a.title.toLowerCase().includes(busca.toLowerCase()));
  const publicados = artigos.filter(a => a.status === 'published').length;

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          O assistente só responde com o que estiver <strong>publicado</strong> aqui. Sem artigo, ele
          admite que não sabe — isso é proposital: melhor admitir do que inventar.
          Vídeo continua sendo cadastrado em <strong>Treinamento</strong>; aqui você só diz as palavras
          que a pessoa usaria pra pedir cada um.
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant={aba === 'artigos' ? 'default' : 'outline'} size="sm" onClick={() => setAba('artigos')}>
          <BookOpen className="mr-1.5 h-3.5 w-3.5" /> Artigos ({publicados}/{artigos.length})
        </Button>
        <Button variant={aba === 'videos' ? 'default' : 'outline'} size="sm" onClick={() => setAba('videos')}>
          <PlayCircle className="mr-1.5 h-3.5 w-3.5" /> Vídeos ({videos.length})
        </Button>
        <div className="flex-1" />
        {aba === 'artigos' && (
          <Button size="sm" onClick={() => setEdit({ ...VAZIO })}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Novo artigo
          </Button>
        )}
      </div>

      {aba === 'artigos' && (
        <>
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={e => setBusca(e.target.value)}
                   placeholder="Buscar artigo" className="h-9 pl-8 text-xs" />
          </div>

          {filtrados.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <BookOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-medium">Nenhum artigo ainda</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Enquanto a base estiver vazia, o suporte vai dizer que não encontrou material.
              </p>
            </CardContent></Card>
          ) : (
            <div className="space-y-2">
              {filtrados.map(a => (
                <Card key={a.id} className="cursor-pointer transition hover:border-primary/40"
                      onClick={() => setEdit(a)}>
                  <CardContent className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{a.title}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {cats.find(c => c.id === a.category_id)?.name ?? 'Sem categoria'}
                        {a.keywords.length > 0 && ` · ${a.keywords.length} palavra(s)-chave`}
                      </p>
                    </div>
                    <Badge variant={a.status === 'published' ? 'default' : 'secondary'} className="shrink-0 text-[10px]">
                      {a.status === 'published' ? 'Publicado' : a.status === 'draft' ? 'Rascunho' : 'Arquivado'}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {aba === 'videos' && (
        <div className="space-y-2">
          {videos.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-xs text-muted-foreground">
              Nenhum vídeo global em Treinamento ainda.
            </CardContent></Card>
          ) : videos.map(v => (
            <VideoRow key={v.id} v={v} cats={cats} onSave={salvarVideo} />
          ))}
        </div>
      )}

      {/* Editor de artigo */}
      <Dialog open={!!edit} onOpenChange={o => !o && setEdit(null)}>
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">{edit?.id ? 'Editar artigo' : 'Novo artigo'}</DialogTitle>
          </DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Título</label>
                <Input value={edit.title ?? ''} className="text-xs"
                       onChange={e => setEdit({ ...edit, title: e.target.value,
                         slug: edit.id ? edit.slug : gerarSlug(e.target.value) })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Categoria</label>
                  <Select value={edit.category_id ?? 'none'}
                          onValueChange={v => setEdit({ ...edit, category_id: v === 'none' ? null : v })}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem categoria</SelectItem>
                      {cats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</label>
                  <Select value={edit.status ?? 'draft'} onValueChange={v => setEdit({ ...edit, status: v })}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Rascunho (IA não vê)</SelectItem>
                      <SelectItem value="published">Publicado (IA responde com isso)</SelectItem>
                      <SelectItem value="archived">Arquivado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Resumo</label>
                <Input value={edit.summary ?? ''} className="text-xs"
                       onChange={e => setEdit({ ...edit, summary: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Conteúdo — escreva o passo a passo como você explicaria pro cliente
                </label>
                <Textarea value={edit.content ?? ''} rows={9} className="text-xs"
                          onChange={e => setEdit({ ...edit, content: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Palavras-chave (vírgula) — é o que mais faz a busca acertar
                </label>
                <Input className="text-xs" defaultValue={(edit.keywords ?? []).join(', ')}
                       onChange={e => setEdit({ ...edit, keywords: paraArray(e.target.value) })}
                       placeholder="whatsapp, uazapi, qr code, conectar numero" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Perguntas que este artigo responde (vírgula)
                </label>
                <Input className="text-xs" defaultValue={(edit.related_questions ?? []).join(', ')}
                       onChange={e => setEdit({ ...edit, related_questions: paraArray(e.target.value) })}
                       placeholder="como conecto meu whatsapp?, meu numero caiu" />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setEdit(null)}>Cancelar</Button>
                <Button size="sm" onClick={salvarArtigo} disabled={salvando}>
                  {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                  Salvar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Linha de vídeo: só enriquece o que já existe no /treinamento. */
function VideoRow({ v, cats, onSave }: {
  v: Video; cats: Categoria[];
  onSave: (v: Video, kw: string[], slug: string | null) => void;
}) {
  const [kw, setKw] = useState((v.keywords ?? []).join(', '));
  const [slug, setSlug] = useState(v.support_category_slug ?? 'none');
  const mudou = kw !== (v.keywords ?? []).join(', ') || slug !== (v.support_category_slug ?? 'none');

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-xs">
          <PlayCircle className="h-3.5 w-3.5 text-primary" />
          <span className="truncate">{v.title}</span>
          <a href={v.video_url} target="_blank" rel="noopener noreferrer"
             className="text-muted-foreground hover:text-primary" onClick={e => e.stopPropagation()}>
            <ExternalLink className="h-3 w-3" />
          </a>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
          <Input value={kw} onChange={e => setKw(e.target.value)} className="h-8 text-xs"
                 placeholder="Palavras que a pessoa usaria pra pedir este vídeo (vírgula)" />
          <Select value={slug} onValueChange={setSlug}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Categoria" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sem categoria</SelectItem>
              {cats.map(c => <SelectItem key={c.id} value={c.slug}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {mudou && (
          <Button size="sm" className="h-7 text-xs"
                  onClick={() => onSave(v, paraArray(kw), slug === 'none' ? null : slug)}>
            <Save className="mr-1 h-3 w-3" /> Salvar
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
