import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Paperclip, Upload, Loader2, Trash2, Download, Eye,
  FileText, FileSpreadsheet, Image as ImageIcon, File as FileIcon,
} from 'lucide-react';

const BUCKET = 'lead-docs';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx';
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx'];
const DOC_TYPES = [
  'RG', 'CNH', 'CPF', 'Comprovante de renda', 'Comprovante de endereço',
  'Simulação', 'Contrato', 'Outro',
];
const SEM_ETIQUETA = '__none__';

interface Attachment {
  id: string;
  lead_id: string;
  lead_source: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  doc_type: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

function isImage(a: Attachment): boolean {
  return (a.mime_type || '').startsWith('image/')
    || /\.(jpg|jpeg|png|webp|gif)$/i.test(a.file_name);
}

function FileGlyph({ a }: { a: Attachment }) {
  const name = a.file_name.toLowerCase();
  if (isImage(a)) return <ImageIcon className="h-5 w-5 text-blue-400" />;
  if (name.endsWith('.pdf')) return <FileText className="h-5 w-5 text-red-400" />;
  if (name.endsWith('.doc') || name.endsWith('.docx')) return <FileText className="h-5 w-5 text-sky-400" />;
  if (name.endsWith('.xls') || name.endsWith('.xlsx')) return <FileSpreadsheet className="h-5 w-5 text-emerald-400" />;
  return <FileIcon className="h-5 w-5 text-muted-foreground" />;
}

export function LeadAttachments({ leadId, leadSource }: { leadId: string; leadSource: 'pedro' | 'marcos' }) {
  const { user } = useAuth();
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingType, setPendingType] = useState<string>(SEM_ETIQUETA);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchItems = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('lead_attachments')
        .select('*')
        .eq('lead_source', leadSource)
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setItems((data as Attachment[]) || []);
    } catch {
      /* silencioso: mostra vazio */
    } finally {
      setLoading(false);
    }
  }, [leadId, leadSource]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleFiles = async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : [];
    if (!list.length) return;
    if (!user?.id) { toast.error('Faça login para anexar arquivos.'); return; }

    setUploading(true);
    let ok = 0;
    try {
      const meta = (user as any).user_metadata || {};
      const uploaderName = meta.full_name || meta.name || user.email || 'Vendedor';
      const docType = pendingType === SEM_ETIQUETA ? null : pendingType;

      for (const file of list) {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        if (!ALLOWED_EXT.includes(ext)) {
          toast.error(`${file.name}: tipo não suportado (use imagem, PDF, Word ou Excel).`);
          continue;
        }
        if (file.size > MAX_BYTES) {
          toast.error(`${file.name}: muito grande (máx. 10 MB).`);
          continue;
        }
        const path = `${leadSource}/${leadId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (upErr) { toast.error(`Erro ao enviar ${file.name}.`); continue; }

        const { error: insErr } = await (supabase as any).from('lead_attachments').insert({
          lead_id: leadId,
          lead_source: leadSource,
          storage_path: path,
          file_name: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
          doc_type: docType,
          uploaded_by: user.id,
          uploaded_by_name: uploaderName,
        });
        if (insErr) {
          await supabase.storage.from(BUCKET).remove([path]); // desfaz o upload órfão
          toast.error(`Erro ao salvar ${file.name}.`);
          continue;
        }
        ok++;
      }
      if (ok > 0) {
        toast.success(ok === 1 ? 'Documento anexado.' : `${ok} documentos anexados.`);
        setPendingType(SEM_ETIQUETA);
        await fetchItems();
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const openFile = async (a: Attachment, download: boolean) => {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(a.storage_path, 120, download ? { download: a.file_name } : undefined);
    if (error || !data?.signedUrl) { toast.error('Não foi possível abrir o arquivo.'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const remove = async (a: Attachment) => {
    if (!confirm(`Excluir "${a.file_name}"? Esta ação não pode ser desfeita.`)) return;
    const { error } = await (supabase as any).from('lead_attachments').delete().eq('id', a.id);
    if (error) { toast.error('Erro ao excluir: ' + error.message); return; }
    await supabase.storage.from(BUCKET).remove([a.storage_path]).catch(() => {});
    setItems(prev => prev.filter(x => x.id !== a.id));
    toast.success('Documento removido.');
  };

  return (
    <Card className="border-border/60 bg-card/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2">
            <Paperclip className="h-4 w-4 text-muted-foreground" />
            Documentos
            <span className="text-xs font-normal text-muted-foreground">
              {items.length > 0 ? `${items.length} arquivo${items.length > 1 ? 's' : ''}` : ''}
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={pendingType} onValueChange={setPendingType}>
              <SelectTrigger className="h-8 text-xs w-[150px]">
                <SelectValue placeholder="Etiqueta (opcional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_ETIQUETA} className="text-xs">Sem etiqueta</SelectItem>
                {DOC_TYPES.map(t => (
                  <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Anexar arquivo
            </Button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Zona de arrastar e soltar */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => fileRef.current?.click()}
          className={`rounded-lg border border-dashed p-3 text-center text-xs cursor-pointer transition-colors ${
            dragOver ? 'border-primary/60 bg-primary/5 text-foreground' : 'border-border/70 text-muted-foreground hover:border-border'
          }`}
        >
          Arraste imagens ou PDFs aqui, ou clique para anexar (até 10 MB)
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando documentos...
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1">Nenhum documento anexado ainda.</p>
        ) : (
          <div className="flex flex-col">
            {items.map((a) => (
              <div key={a.id} className="flex items-center gap-3 py-2.5 border-t border-border/50 first:border-t-0">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted/50 shrink-0">
                  <FileGlyph a={a} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{a.file_name}</span>
                    {a.doc_type && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0">
                        {a.doc_type}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {fmtSize(a.size_bytes)}
                    {a.uploaded_by_name ? ` · ${a.uploaded_by_name}` : ''}
                    {` · ${fmtDate(a.created_at)}`}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" title="Ver" onClick={() => openFile(a, false)}>
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" title="Baixar" onClick={() => openFile(a, true)}>
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400 hover:text-red-300" title="Excluir" onClick={() => remove(a)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
