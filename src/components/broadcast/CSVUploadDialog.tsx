import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileText, CheckCircle, AlertTriangle, Loader2, Download } from 'lucide-react';

interface CSVUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  sellerMemberId?: string | null;
  onUploadComplete: () => void;
}

interface ParsedContact {
  phone: string;
  name: string | null;
  metadata: Record<string, string>;
  valid: boolean;
  error?: string;
}

export function CSVUploadDialog({ open, onOpenChange, userId, sellerMemberId = null, onUploadComplete }: CSVUploadDialogProps) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [listName, setListName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedContact[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const normalizePhone = (raw: string): string => {
    let digits = raw.replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '55' + digits.slice(1);
    if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
    return digits;
  };

  const validatePhone = (phone: string): boolean => {
    return /^55\d{10,11}$/.test(phone);
  };

  const parseCSV = (text: string): ParsedContact[] => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return [];

    const headerLine = lines[0].toLowerCase();
    const separator = headerLine.includes(';') ? ';' : ',';
    const headers = lines[0].split(separator).map(h => h.trim().toLowerCase().replace(/"/g, ''));

    const phoneIdx = headers.findIndex(h =>
      ['phone', 'telefone', 'numero', 'número', 'whatsapp', 'celular', 'tel', 'fone'].includes(h)
    );
    const nameIdx = headers.findIndex(h =>
      ['name', 'nome', 'contato', 'contact'].includes(h)
    );

    if (phoneIdx === -1) {
      // Try first column as phone
      return lines.slice(1).map(line => {
        const cols = line.split(separator).map(c => c.trim().replace(/"/g, ''));
        const rawPhone = cols[0] || '';
        const normalized = normalizePhone(rawPhone);
        const valid = validatePhone(normalized);
        return {
          phone: normalized,
          name: cols[1] || null,
          metadata: {},
          valid,
          error: valid ? undefined : `Número inválido: ${rawPhone}`,
        };
      });
    }

    return lines.slice(1).map(line => {
      const cols = line.split(separator).map(c => c.trim().replace(/"/g, ''));
      const rawPhone = cols[phoneIdx] || '';
      const normalized = normalizePhone(rawPhone);
      const valid = validatePhone(normalized);
      const metadata: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (i !== phoneIdx && i !== nameIdx && cols[i]) {
          metadata[h] = cols[i];
        }
      });
      return {
        phone: normalized,
        name: nameIdx >= 0 ? cols[nameIdx] || null : null,
        metadata,
        valid,
        error: valid ? undefined : `Número inválido: ${rawPhone}`,
      };
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setIsParsing(true);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const contacts = parseCSV(text);
      setParsed(contacts);
      setIsParsing(false);
      if (!listName) {
        setListName(f.name.replace(/\.(csv|txt|xlsx?)$/i, ''));
      }
    };
    reader.readAsText(f);
  };

  const validContacts = parsed.filter(c => c.valid);
  const invalidContacts = parsed.filter(c => !c.valid);

  const handleUpload = async () => {
    if (!listName.trim() || validContacts.length === 0) return;
    setIsUploading(true);
    setUploadProgress(0);

    try {
      // 1. Create list
      const { data: list, error: listErr } = await (supabase as any)
        .from('wa_contact_lists')
        .insert({
          user_id: userId,
          name: listName.trim(),
          source: 'csv_upload',
          contact_count: validContacts.length,
          seller_member_id: sellerMemberId,
        })
        .select('id')
        .single();

      if (listErr) throw listErr;

      // 2. Insert contacts in batches
      const batchSize = 200;
      const deduped = new Map<string, ParsedContact>();
      for (const c of validContacts) {
        if (!deduped.has(c.phone)) deduped.set(c.phone, c);
      }
      const uniqueContacts = Array.from(deduped.values());

      for (let i = 0; i < uniqueContacts.length; i += batchSize) {
        const batch = uniqueContacts.slice(i, i + batchSize).map(c => ({
          user_id: userId,
          list_id: list.id,
          phone: c.phone,
          name: c.name,
          source: 'csv_upload',
          is_valid: true,
          metadata: Object.keys(c.metadata).length > 0 ? c.metadata : null,
        }));

        const { error: insertErr } = await supabase.from('wa_contacts').insert(batch);
        if (insertErr) throw insertErr;

        setUploadProgress(Math.round(((i + batch.length) / uniqueContacts.length) * 100));
      }

      // 3. Update list count with deduplicated count
      await supabase
        .from('wa_contact_lists')
        .update({ contact_count: uniqueContacts.length })
        .eq('id', list.id);

      toast({ title: '✅ Lista importada!', description: `${uniqueContacts.length} contatos adicionados à lista "${listName}"` });
      resetForm();
      onUploadComplete();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Erro na importação', description: err.message, variant: 'destructive' });
    } finally {
      setIsUploading(false);
    }
  };

  const resetForm = () => {
    setFile(null);
    setParsed([]);
    setListName('');
    setUploadProgress(0);
    if (fileRef.current) fileRef.current.value = '';
  };

  const downloadTemplate = () => {
    const csv = 'telefone;nome;empresa;cargo\n5511999999999;João Silva;Empresa X;Gerente\n5521988888888;Maria Santos;Empresa Y;Diretora';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo-contatos.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Importar Lista de Contatos
          </DialogTitle>
          <DialogDescription>
            Faça upload de um arquivo CSV com seus contatos
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nome da lista</Label>
            <Input
              value={listName}
              onChange={e => setListName(e.target.value)}
              placeholder="Ex: Leads Black Friday"
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Arquivo CSV</Label>
              <Button variant="ghost" size="sm" onClick={downloadTemplate} className="text-xs h-7">
                <Download className="h-3 w-3 mr-1" /> Baixar modelo
              </Button>
            </div>

            <div
              className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              {file ? (
                <div className="flex items-center justify-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  <span className="text-sm font-medium">{file.name}</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Clique para selecionar um arquivo CSV
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Colunas: telefone, nome (opcional), campos extras
                  </p>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {isParsing && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Processando arquivo...
            </div>
          )}

          {parsed.length > 0 && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium text-green-500">{validContacts.length} válidos</span>
                  </div>
                </div>
                {invalidContacts.length > 0 && (
                  <div className="flex-1 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      <span className="text-sm font-medium text-destructive">{invalidContacts.length} inválidos</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Preview */}
              <div className="max-h-32 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left p-2">Telefone</th>
                      <th className="text-left p-2">Nome</th>
                      <th className="text-left p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.slice(0, 20).map((c, i) => (
                      <tr key={i} className="border-t border-border/50">
                        <td className="p-2 font-mono">{c.phone}</td>
                        <td className="p-2">{c.name || '-'}</td>
                        <td className="p-2">
                          {c.valid ? (
                            <Badge variant="secondary" className="text-[10px] bg-green-500/10 text-green-500">OK</Badge>
                          ) : (
                            <Badge variant="destructive" className="text-[10px]">Inválido</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.length > 20 && (
                  <p className="text-xs text-muted-foreground p-2 text-center">
                    ... e mais {parsed.length - 20} contatos
                  </p>
                )}
              </div>
            </div>
          )}

          {isUploading && (
            <div className="space-y-2">
              <Progress value={uploadProgress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">{uploadProgress}% importado</p>
            </div>
          )}

          <Button
            onClick={handleUpload}
            disabled={isUploading || validContacts.length === 0 || !listName.trim()}
            className="w-full"
          >
            {isUploading ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importando...</>
            ) : (
              <><Upload className="h-4 w-4 mr-2" /> Importar {validContacts.length} contatos</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
