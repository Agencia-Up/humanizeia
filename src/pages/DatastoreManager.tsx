import { useState, useRef } from "react";
import { useDatastore, useDatastoreSources, useDatastoreSearch } from "@/hooks/useDatastore";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Database, Plus, FileText, Link, Type, Search,
  Trash2, RefreshCw, Upload, CheckCircle, XCircle,
  Clock, Sparkles, BookOpen
} from "lucide-react";
import { KnowledgeBaseTemplateForm } from "@/components/datastore/KnowledgeBaseTemplateForm";

export default function DatastoreManager() {
  const { datastores, isLoading, createDatastore, deleteDatastore } = useDatastore();
  const [selectedDatastore, setSelectedDatastore] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isAddSourceOpen, setIsAddSourceOpen] = useState(false);
  const [addSourceType, setAddSourceType] = useState<'text' | 'url' | 'file' | 'template'>('text');
  const [isTemplateOpen, setIsTemplateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newDatastore, setNewDatastore] = useState({ name: '', description: '' });
  const [newSource, setNewSource] = useState({ name: '', content: '', url: '' });

  const {
    sources,
    isLoading: loadingSources,
    addTextSource,
    addUrlSource,
    uploadFile,
    deleteSource,
    reprocessSource
  } = useDatastoreSources(selectedDatastore);

  const { search, isSearching, results } = useDatastoreSearch(selectedDatastore);

  const selectedDs = datastores?.find(d => d.id === selectedDatastore);

  const handleCreateDatastore = async () => {
    await createDatastore.mutateAsync(newDatastore);
    setIsCreateOpen(false);
    setNewDatastore({ name: '', description: '' });
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    await search(searchQuery);
  };

  const handleAddSource = async () => {
    try {
      if (addSourceType === 'text') {
        await addTextSource.mutateAsync({
          name: newSource.name,
          content: newSource.content
        });
      } else if (addSourceType === 'url') {
        await addUrlSource.mutateAsync({
          name: newSource.name,
          url: newSource.url
        });
      }
      setIsAddSourceOpen(false);
      setNewSource({ name: '', content: '', url: '' });
    } catch (error: any) {
      toast.error('Erro: ' + error.message);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadFile.mutateAsync({ file });
    } catch (error: any) {
      toast.error('Erro: ' + error.message);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />;
      case 'processing':
        return <RefreshCw className="w-5 h-5 text-primary animate-spin" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-destructive" />;
      default:
        return <Clock className="w-5 h-5 text-muted-foreground" />;
    }
  };

  return (
    <MainLayout>
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Database className="w-8 h-8 text-primary" />
              Base de Conhecimento
            </h1>
            <p className="text-muted-foreground">
              Alimente seus agentes de IA com documentos, FAQ e scripts
            </p>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Novo Datastore
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Criar Datastore</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Nome</Label>
                  <Input
                    placeholder="Ex: FAQ Produtos"
                    value={newDatastore.name}
                    onChange={(e) => setNewDatastore({ ...newDatastore, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Descrição</Label>
                  <Textarea
                    placeholder="Descrição do conteúdo..."
                    value={newDatastore.description}
                    onChange={(e) => setNewDatastore({ ...newDatastore, description: e.target.value })}
                  />
                </div>
                <Button
                  onClick={handleCreateDatastore}
                  disabled={!newDatastore.name || createDatastore.isPending}
                  className="w-full"
                >
                  {createDatastore.isPending ? "Criando..." : "Criar Datastore"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle>Seus Datastores</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="text-center py-4">Carregando...</div>
                ) : datastores?.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">
                    Nenhum datastore criado
                  </div>
                ) : (
                  <div className="space-y-2">
                    {datastores?.map((ds) => (
                      <div
                        key={ds.id}
                        className={`p-3 rounded-lg cursor-pointer transition-colors border ${
                          selectedDatastore === ds.id 
                            ? 'bg-primary/10 border-primary' 
                            : 'hover:bg-muted border-transparent'
                        }`}
                        onClick={() => setSelectedDatastore(ds.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{ds.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {ds.total_documents} docs • {ds.total_chunks} chunks
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm('Excluir este datastore?')) {
                                deleteDatastore.mutate(ds.id);
                                if (selectedDatastore === ds.id) setSelectedDatastore(null);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2">
            {selectedDatastore && selectedDs ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{selectedDs.name}</CardTitle>
                      <CardDescription>{selectedDs.description}</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <input type="file" ref={fileInputRef} className="hidden" accept=".txt,.md,.csv" onChange={handleFileUpload} />
                      <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                        <Upload className="w-4 h-4 mr-2" />Upload
                      </Button>
                      <Dialog open={isAddSourceOpen} onOpenChange={setIsAddSourceOpen}>
                        <DialogTrigger asChild>
                          <Button size="sm"><Plus className="w-4 h-4 mr-2" />Adicionar</Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl">
                          <DialogHeader><DialogTitle>Adicionar Conteúdo</DialogTitle></DialogHeader>
                          <div className="space-y-4 py-4">
                            <div className="flex gap-2 flex-wrap">
                              <Button variant={addSourceType === 'text' ? 'default' : 'outline'} size="sm" onClick={() => setAddSourceType('text')}>
                                <Type className="w-4 h-4 mr-2" />Texto
                              </Button>
                              <Button variant={addSourceType === 'url' ? 'default' : 'outline'} size="sm" onClick={() => setAddSourceType('url')}>
                                <Link className="w-4 h-4 mr-2" />URL
                              </Button>
                              <Button variant={addSourceType === 'template' ? 'default' : 'outline'} size="sm" onClick={() => setAddSourceType('template')}>
                                <BookOpen className="w-4 h-4 mr-2" />Template
                              </Button>
                            </div>

                            {addSourceType === 'template' ? (
                              <KnowledgeBaseTemplateForm
                                onSubmit={async (data) => {
                                  await addTextSource.mutateAsync(data);
                                  setIsAddSourceOpen(false);
                                }}
                                isPending={addTextSource.isPending}
                              />
                            ) : (
                              <>
                                <div className="space-y-2">
                                  <Label>Nome</Label>
                                  <Input placeholder="Ex: FAQ de Preços" value={newSource.name} onChange={(e) => setNewSource({ ...newSource, name: e.target.value })} />
                                </div>
                                {addSourceType === 'text' ? (
                                  <div className="space-y-2">
                                    <Label>Conteúdo</Label>
                                    <Textarea placeholder="Cole o texto aqui..." rows={8} value={newSource.content} onChange={(e) => setNewSource({ ...newSource, content: e.target.value })} />
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    <Label>URL</Label>
                                    <Input placeholder="https://..." value={newSource.url} onChange={(e) => setNewSource({ ...newSource, url: e.target.value })} />
                                  </div>
                                )}
                                <Button onClick={handleAddSource} disabled={!newSource.name || (addSourceType === 'text' ? !newSource.content : !newSource.url) || addTextSource.isPending || addUrlSource.isPending} className="w-full">
                                  {addTextSource.isPending || addUrlSource.isPending ? "Adicionando..." : "Adicionar"}
                                </Button>
                              </>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="p-3 bg-muted rounded-lg text-center">
                      <p className="text-2xl font-bold">{selectedDs.total_documents}</p>
                      <p className="text-xs text-muted-foreground">Documentos</p>
                    </div>
                    <div className="p-3 bg-muted rounded-lg text-center">
                      <p className="text-2xl font-bold">{selectedDs.total_chunks}</p>
                      <p className="text-xs text-muted-foreground">Chunks</p>
                    </div>
                    <div className="p-3 bg-muted rounded-lg text-center">
                      <p className="text-2xl font-bold">{(selectedDs.total_tokens || 0).toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">Tokens</p>
                    </div>
                  </div>

                  <Tabs defaultValue="sources">
                    <TabsList>
                      <TabsTrigger value="sources"><FileText className="w-4 h-4 mr-2" />Fontes</TabsTrigger>
                      <TabsTrigger value="search"><Sparkles className="w-4 h-4 mr-2" />Testar Busca</TabsTrigger>
                    </TabsList>

                    <TabsContent value="sources" className="mt-4">
                      {loadingSources ? (
                        <div className="text-center py-4">Carregando...</div>
                      ) : sources?.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">Nenhuma fonte adicionada ainda</div>
                      ) : (
                        <div className="space-y-2">
                          {sources?.map((source) => (
                            <div key={source.id} className="flex items-center justify-between p-4 border rounded-lg">
                              <div className="flex items-center gap-3">
                                {getStatusIcon(source.status)}
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{source.name}</span>
                                    <Badge variant="outline" className="text-xs">{source.source_type}</Badge>
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {source.status === 'completed' && <span>{source.chunks_count} chunks • {(source.tokens_count || 0).toLocaleString()} tokens</span>}
                                    {source.status === 'processing' && <span>Processando...</span>}
                                    {source.status === 'error' && <span className="text-destructive">{source.error_message}</span>}
                                    {source.status === 'pending' && <span>Aguardando processamento</span>}
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <Button variant="ghost" size="icon" onClick={() => reprocessSource.mutate(source.id)} disabled={source.status === 'processing'}>
                                  <RefreshCw className="w-4 h-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => { if (confirm('Excluir esta fonte?')) deleteSource.mutate(source.id); }}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="search" className="mt-4">
                      <div className="space-y-4">
                        <div className="flex gap-2">
                          <Input placeholder="Faça uma pergunta para testar a busca..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
                          <Button onClick={handleSearch} disabled={isSearching}>
                            {isSearching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                          </Button>
                        </div>
                        {results.length > 0 && (
                          <div className="space-y-3">
                            <p className="text-sm text-muted-foreground">{results.length} resultados encontrados</p>
                            {results.map((result: any, index: number) => (
                              <Card key={index}>
                                <CardContent className="p-4">
                                  <div className="flex items-center justify-between mb-2">
                                    <Badge variant="outline">{result.source}</Badge>
                                    <span className="text-xs text-muted-foreground">Similaridade: {(result.similarity * 100).toFixed(1)}%</span>
                                  </div>
                                  <p className="text-sm">{result.content}</p>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            ) : (
              <Card className="h-full flex items-center justify-center">
                <CardContent className="text-center py-12">
                  <Database className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Selecione um datastore para gerenciar</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
