import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  BookOpen, Plus, Loader2, Trash2, FileText, Link, HelpCircle,
  CheckCircle2, AlertCircle, Clock, ChevronDown, ChevronUp, Database,
  RefreshCw, Info, Zap,
} from 'lucide-react';

interface KnowledgeSource {
  id: string;
  kb_id: string;
  type: 'text' | 'qa' | 'url' | 'pdf' | 'youtube';
  name: string;
  content: string;
  metadata: Record<string, unknown>;
  token_count: number;
  chunk_count: number;
  status: 'pending' | 'processing' | 'synced' | 'error';
  error_message?: string;
  last_synced_at?: string;
  created_at: string;
}

interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  icon: string;
  rag_restricted: boolean;
  is_public: boolean;
  created_at: string;
}

interface KnowledgeBaseManagerProps {
  agentId: string | null;
  userId: string;
}

const SOURCE_TYPE_CONFIG = {
  text: { icon: FileText, label: 'Texto', color: 'text-blue-400' },
  qa: { icon: HelpCircle, label: 'Q&A', color: 'text-violet-400' },
  url: { icon: Link, label: 'URL', color: 'text-teal-400' },
  pdf: { icon: FileText, label: 'PDF', color: 'text-red-400' },
  youtube: { icon: FileText, label: 'YouTube', color: 'text-red-400' },
};

const STATUS_CONFIG = {
  synced: { icon: CheckCircle2, label: 'Sincronizado', color: 'text-green-400' },
  pending: { icon: Clock, label: 'Pendente', color: 'text-yellow-400' },
  processing: { icon: Loader2, label: 'Processando', color: 'text-blue-400' },
  error: { icon: AlertCircle, label: 'Erro', color: 'text-red-400' },
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function SourceCard({ source, onDelete, onResync }: { source: KnowledgeSource; onDelete: () => void; onResync: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const typeConf = SOURCE_TYPE_CONFIG[source.type] || SOURCE_TYPE_CONFIG.text;
  const statusConf = STATUS_CONFIG[source.status] || STATUS_CONFIG.pending;
  const TypeIcon = typeConf.icon;
  const StatusIcon = statusConf.icon;

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden transition-all">
      <div className="flex items-center gap-3 p-3">
        <div className={`p-1.5 rounded-lg bg-muted/50 ${typeConf.color}`}>
          <TypeIcon className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{source.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`flex items-center gap-1 text-[10px] ${statusConf.color}`}>
              <StatusIcon className={`h-2.5 w-2.5 ${source.status === 'processing' ? 'animate-spin' : ''}`} />
              {statusConf.label}
            </span>
            {source.token_count > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {source.token_count.toLocaleString()} tokens · {source.chunk_count} chunks
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-violet-400"
            onClick={onResync}
            title="Re-processar embeddings"
          >
            <Zap className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {expanded && source.content && (
        <div className="px-3 pb-3 border-t border-border/30">
          <p className="text-xs text-muted-foreground mt-2 whitespace-pre-wrap line-clamp-6">
            {source.content}
          </p>
        </div>
      )}
    </div>
  );
}

export function KnowledgeBaseManager({ agentId, userId }: KnowledgeBaseManagerProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // KB state
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [linkedKbIds, setLinkedKbIds] = useState<string[]>([]);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);

  // Form: nova KB
  const [showNewKb, setShowNewKb] = useState(false);
  const [newKbName, setNewKbName] = useState('');
  const [newKbDesc, setNewKbDesc] = useState('');
  const [ragRestricted, setRagRestricted] = useState(false);

  // Form: nova fonte
  const [sourceTab, setSourceTab] = useState<'text' | 'qa' | 'url'>('text');
  const [sourceName, setSourceName] = useState('');
  const [sourceContent, setSourceContent] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaAnswer, setQaAnswer] = useState('');
  const [showAddSource, setShowAddSource] = useState(false);

  const fetchKbs = useCallback(async () => {
    setLoading(true);
    try {
      const query = (supabase as any)
        .from('knowledge_bases')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      const { data, error } = await query;
      if (error) throw error;
      setKbs(data || []);

      if (agentId) {
        const { data: linkedData } = await (supabase as any)
          .from('agent_knowledge_bases')
          .select('kb_id')
          .eq('agent_id', agentId);
        setLinkedKbIds((linkedData || []).map((k: any) => k.kb_id));
      } else {
        setLinkedKbIds([]);
      }

      // Seleciona a primeira automaticamente
      if ((data || []).length > 0 && !selectedKbId) {
        setSelectedKbId(data[0].id);
      }
    } catch (err: any) {
      console.error('Erro ao carregar KBs:', err);
    } finally {
      setLoading(false);
    }
  }, [userId, agentId]);

  const fetchSources = useCallback(async () => {
    if (!selectedKbId) return;
    try {
      const { data, error } = await (supabase as any)
        .from('knowledge_sources')
        .select('*')
        .eq('kb_id', selectedKbId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSources(data || []);
    } catch (err) {
      console.error('Erro ao carregar fontes:', err);
    }
  }, [selectedKbId]);

  useEffect(() => { fetchKbs(); }, [fetchKbs]);
  useEffect(() => { fetchSources(); }, [fetchSources]);

  const handleCreateKb = async () => {
    if (!newKbName.trim()) return;
    setSaving(true);
    try {
      const { data, error } = await (supabase as any)
        .from('knowledge_bases')
        .insert({
          user_id: userId,
          agent_id: agentId,
          name: newKbName.trim(),
          description: newKbDesc.trim() || null,
          rag_restricted: ragRestricted,
          icon: '📚',
        })
        .select()
        .single();

      if (error) throw error;
      
      // Auto vincular ao agente se existir
      if (agentId) {
        await (supabase as any).from('agent_knowledge_bases').insert({ agent_id: agentId, kb_id: data.id });
      }

      toast({ title: 'Base de conhecimento criada!' });
      setNewKbName('');
      setNewKbDesc('');
      setRagRestricted(false);
      setShowNewKb(false);
      await fetchKbs();
      setSelectedKbId(data.id);
    } catch (err: any) {
      toast({ title: 'Erro ao criar base', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleLink = async (checked: boolean) => {
    if (!agentId || !selectedKbId) {
      if (!agentId) toast({ title: 'Aviso', description: 'Salve o agente primeiro antes de vincular bases.' });
      return;
    }
    
    setSaving(true);
    try {
      if (checked) {
        await (supabase as any).from('agent_knowledge_bases').insert({ agent_id: agentId, kb_id: selectedKbId });
        setLinkedKbIds(prev => [...prev, selectedKbId]);
        toast({ title: 'Base ativada para este agente!' });
      } else {
        await (supabase as any).from('agent_knowledge_bases').delete().match({ agent_id: agentId, kb_id: selectedKbId });
        setLinkedKbIds(prev => prev.filter(id => id !== selectedKbId));
        toast({ title: 'Base desativada deste agente!' });
      }
    } catch (err: any) {
      toast({ title: 'Erro ao vincular', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleAddSource = async () => {
    if (!selectedKbId) return;

    let content = '';
    let name = sourceName;
    let metadata: Record<string, unknown> = {};

    if (sourceTab === 'text') {
      content = sourceContent;
      if (!content.trim()) { toast({ title: 'Digite o conteúdo', variant: 'destructive' }); return; }
      if (!name.trim()) name = `Texto ${new Date().toLocaleDateString('pt-BR')}`;
    } else if (sourceTab === 'qa') {
      if (!qaQuestion.trim() || !qaAnswer.trim()) {
        toast({ title: 'Preencha pergunta e resposta', variant: 'destructive' }); return;
      }
      content = `Pergunta: ${qaQuestion.trim()}\nResposta: ${qaAnswer.trim()}`;
      if (!name.trim()) name = qaQuestion.trim().slice(0, 60);
      metadata = { question: qaQuestion.trim(), answer: qaAnswer.trim() };
    } else if (sourceTab === 'url') {
      if (!sourceUrl.trim()) { toast({ title: 'Digite a URL', variant: 'destructive' }); return; }
      content = `[Conteúdo da URL será extraído automaticamente]\n${sourceUrl.trim()}`;
      if (!name.trim()) name = sourceUrl.trim();
      metadata = { url: sourceUrl.trim() };
    }

    const tokens = estimateTokens(content);

    setSaving(true);
    try {
      const { data: newSource, error } = await (supabase as any)
        .from('knowledge_sources')
        .insert({
          kb_id: selectedKbId,
          user_id: userId,
          type: sourceTab,
          name,
          content,
          metadata,
          token_count: tokens,
          chunk_count: 0,
          status: 'pending', // será atualizado pela Edge Function
        })
        .select()
        .single();

      if (error) throw error;

      toast({ title: 'Fonte adicionada!', description: 'Gerando embeddings em background...' });
      setSourceName('');
      setSourceContent('');
      setSourceUrl('');
      setQaQuestion('');
      setQaAnswer('');
      setShowAddSource(false);
      await fetchSources();

      // Chamar Edge Function para gerar embeddings em background
      if (newSource?.id) {
        embedSource(newSource.id);
      }
    } catch (err: any) {
      toast({ title: 'Erro ao adicionar fonte', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Chama a Edge Function de embedding (em background, sem bloquear UI)
  const embedSource = async (sourceId: string) => {
    try {
      console.log('[KB] Iniciando embedding para fonte:', sourceId);
      const { data, error } = await supabase.functions.invoke('knowledge-embed', {
        body: { source_id: sourceId },
      });

      if (error || data?.error) {
        const message = error?.message || data?.error || 'Falha ao iniciar processamento da base';
        console.error('[KB] Erro no embedding:', message);
        await (supabase as any)
          .from('knowledge_sources')
          .update({
            status: 'error',
            error_message: message,
          })
          .eq('id', sourceId);
        toast({
          title: 'Falha ao processar a fonte',
          description: message,
          variant: 'destructive',
        });
        await fetchSources();
        return;
      }

      console.log('[KB] Embedding concluído para:', sourceId);
      // Recarrega fontes para mostrar status atualizado
      setTimeout(() => fetchSources(), 1000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro inesperado ao processar a base.';
      console.warn('[KB] Falha ao chamar knowledge-embed:', err);
      try {
        await (supabase as any)
          .from('knowledge_sources')
          .update({
            status: 'error',
            error_message: message,
          })
          .eq('id', sourceId);
      } catch (updateErr) {
        console.warn('[KB] Não foi possível registrar erro da fonte:', updateErr);
      }
      toast({
        title: 'Falha ao processar a fonte',
        description: message,
        variant: 'destructive',
      });
      await fetchSources();
    }
  };

  const handleResyncSource = async (sourceId: string) => {
    toast({ title: '⚡ Re-processando embeddings...', description: 'Isso pode levar alguns segundos' });
    await embedSource(sourceId);
    await fetchSources();
  };


  const handleDeleteSource = async (sourceId: string) => {
    if (!confirm('Remover esta fonte de dados?')) return;
    try {
      await (supabase as any).from('knowledge_sources').delete().eq('id', sourceId);
      toast({ title: 'Fonte removida' });
      fetchSources();
    } catch (err: any) {
      toast({ title: 'Erro ao remover', description: err.message, variant: 'destructive' });
    }
  };

  const handleDeleteKb = async (kbId: string) => {
    if (!confirm('Excluir esta base e todas as suas fontes?')) return;
    try {
      await (supabase as any).from('knowledge_bases').delete().eq('id', kbId);
      toast({ title: 'Base excluída!' });
      setSelectedKbId(null);
      fetchKbs();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const selectedKb = kbs.find(k => k.id === selectedKbId);
  const totalTokens = sources.reduce((s, src) => s + (src.token_count || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-violet-500/10 border border-violet-500/20 text-xs text-violet-300">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          A Base de Conhecimento permite que o Pedro responda com precisão usando suas informações.
          Adicione textos, Q&As e URLs para que o agente aprenda com elas.
        </span>
      </div>

      {/* KB List or empty */}
      {kbs.length === 0 && !showNewKb ? (
        <div className="text-center py-8 rounded-xl border border-dashed border-border/50">
          <Database className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium">Nenhuma base criada</p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">Crie uma base para o Pedro aprender</p>
          <Button size="sm" variant="outline" onClick={() => setShowNewKb(true)} className="gap-1">
            <Plus className="h-3.5 w-3.5" /> Criar Base
          </Button>
        </div>
      ) : (
        <>
          {/* KB selector + actions */}
          <div className="flex items-center gap-2 w-full">
            <Select value={selectedKbId || ''} onValueChange={setSelectedKbId}>
              <SelectTrigger className="flex-1 text-xs h-9 font-medium">
                <SelectValue placeholder="Selecione uma base de conhecimento" />
              </SelectTrigger>
              <SelectContent>
                {kbs.map(kb => (
                  <SelectItem key={kb.id} value={kb.id} className="text-xs">
                    <span className="flex items-center gap-2">
                      <span>{kb.icon}</span>
                      <span>{kb.name}</span>
                      {linkedKbIds.includes(kb.id) && (
                        <span className="text-[9px] text-green-500 font-bold bg-green-500/10 px-1.5 py-0.5 rounded uppercase">Ativa</span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="h-9 shrink-0 gap-1 border-dashed" onClick={() => setShowNewKb(!showNewKb)}>
              <Plus className="h-4 w-4" /> Nova Base
            </Button>
            {selectedKbId && (
              <Button
                size="sm"
                variant="ghost"
                className="h-9 w-9 p-0 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => selectedKbId && handleDeleteKb(selectedKbId)}
                title="Excluir Permanentemente"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </>
      )}

      {/* New KB form */}
      {showNewKb && (
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-3">
          <h4 className="text-sm font-semibold">Nova Base de Conhecimento</h4>
          <div className="space-y-2">
            <Input
              placeholder="Nome da base (ex: FAQ Produto, Manual de Vendas)"
              value={newKbName}
              onChange={e => setNewKbName(e.target.value)}
              className="text-sm h-8"
            />
            <Input
              placeholder="Descrição (opcional)"
              value={newKbDesc}
              onChange={e => setNewKbDesc(e.target.value)}
              className="text-sm h-8"
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch checked={ragRestricted} onCheckedChange={setRagRestricted} id="rag-restricted" />
                <Label htmlFor="rag-restricted" className="text-xs cursor-pointer">
                  Modo Restrito — Pedro responde SOMENTE com esta base
                </Label>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreateKb} disabled={saving || !newKbName.trim()} className="gap-1">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Criar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowNewKb(false)}>Cancelar</Button>
          </div>
        </div>
      )}

      {/* Selected KB content */}
      {selectedKb && (
        <div className="space-y-3">
          {/* KB header */}
          <div className="flex items-start justify-between w-full gap-2">
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <span className="shrink-0">{selectedKb.icon}</span> 
                <span className="truncate" title={selectedKb.name}>{selectedKb.name}</span>
                {selectedKb.rag_restricted && (
                  <Badge variant="outline" className="shrink-0 text-[10px] bg-violet-500/10 text-violet-400 border-violet-500/30">Restrito</Badge>
                )}
              </h4>
              <div className="flex items-center gap-4 mt-2">
                <p className="text-xs text-muted-foreground">
                  {sources.length} {sources.length === 1 ? 'fonte' : 'fontes'} · {totalTokens.toLocaleString()} tokens
                </p>
                {agentId ? (
                  <div className="flex items-center gap-2 border-l border-border pl-4">
                    <Switch 
                      id="link-kb" 
                      checked={linkedKbIds.includes(selectedKb.id)} 
                      onCheckedChange={handleToggleLink}
                      disabled={saving}
                    />
                    <Label htmlFor="link-kb" className={`text-xs cursor-pointer font-medium ${linkedKbIds.includes(selectedKb.id) ? 'text-green-400' : 'text-muted-foreground'}`}>
                      {linkedKbIds.includes(selectedKb.id) ? 'Ativa neste Agente' : 'Inativa neste Agente'}
                    </Label>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 border-l border-border pl-4 opacity-50">
                    <Switch disabled />
                    <Label className="text-[10px]">Salve o agente para ativar</Label>
                  </div>
                )}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0 gap-1 text-xs"
              onClick={() => setShowAddSource(!showAddSource)}
            >
              <Plus className="h-3 w-3" /> Adicionar Fonte
            </Button>
          </div>

          {/* Add source form */}
          {showAddSource && (
            <div className="p-4 rounded-xl border border-border/50 bg-muted/20 space-y-3">
              <Tabs value={sourceTab} onValueChange={v => setSourceTab(v as any)}>
                <TabsList className="h-7 text-xs">
                  <TabsTrigger value="text" className="text-xs gap-1 h-6">
                    <FileText className="h-3 w-3" /> Texto
                  </TabsTrigger>
                  <TabsTrigger value="qa" className="text-xs gap-1 h-6">
                    <HelpCircle className="h-3 w-3" /> Q&A
                  </TabsTrigger>
                  <TabsTrigger value="url" className="text-xs gap-1 h-6">
                    <Link className="h-3 w-3" /> URL
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="text" className="space-y-2 mt-3">
                  <Input
                    placeholder="Nome da fonte (ex: Manual do Produto)"
                    value={sourceName}
                    onChange={e => setSourceName(e.target.value)}
                    className="text-xs h-8"
                  />
                  <Textarea
                    placeholder="Cole aqui o texto que o Pedro deve conhecer..."
                    value={sourceContent}
                    onChange={e => setSourceContent(e.target.value)}
                    rows={5}
                    className="text-xs resize-none"
                  />
                  {sourceContent && (
                    <p className="text-[10px] text-muted-foreground">
                      ~{estimateTokens(sourceContent).toLocaleString()} tokens
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="qa" className="space-y-2 mt-3">
                  <Input
                    placeholder="Nome (opcional)"
                    value={sourceName}
                    onChange={e => setSourceName(e.target.value)}
                    className="text-xs h-8"
                  />
                  <Input
                    placeholder="Pergunta (ex: Qual o horário de atendimento?)"
                    value={qaQuestion}
                    onChange={e => setQaQuestion(e.target.value)}
                    className="text-xs h-8"
                  />
                  <Textarea
                    placeholder="Resposta (ex: Atendemos de segunda a sexta das 8h às 18h)"
                    value={qaAnswer}
                    onChange={e => setQaAnswer(e.target.value)}
                    rows={3}
                    className="text-xs resize-none"
                  />
                </TabsContent>

                <TabsContent value="url" className="space-y-2 mt-3">
                  <Input
                    placeholder="Nome (ex: Site da empresa)"
                    value={sourceName}
                    onChange={e => setSourceName(e.target.value)}
                    className="text-xs h-8"
                  />
                  <Input
                    placeholder="https://suaempresa.com.br/sobre"
                    value={sourceUrl}
                    onChange={e => setSourceUrl(e.target.value)}
                    className="text-xs h-8"
                    type="url"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    ℹ️ O conteúdo da página será salvo para o Pedro consultar
                  </p>
                </TabsContent>
              </Tabs>

              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddSource} disabled={saving} className="gap-1 text-xs">
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  Adicionar
                </Button>
                <Button size="sm" variant="ghost" className="text-xs" onClick={() => setShowAddSource(false)}>Cancelar</Button>
              </div>
            </div>
          )}

          {/* Sources list */}
          <ScrollArea className="max-h-60">
            <div className="space-y-2 pr-2">
              {sources.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <BookOpen className="h-6 w-6 mx-auto mb-2 opacity-50" />
                  <p className="text-xs">Nenhuma fonte adicionada ainda</p>
                </div>
              ) : (
                sources.map(source => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    onDelete={() => handleDeleteSource(source.id)}
                    onResync={() => handleResyncSource(source.id)}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
