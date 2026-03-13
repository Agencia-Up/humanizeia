import { useState, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileSpreadsheet, FileText, CheckCircle, AlertCircle, Loader2, X } from 'lucide-react';
import * as XLSX from 'xlsx';

interface FileImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  lists: { id: string; name: string }[];
  onSuccess: () => void;
}

interface ParsedContact {
  phone: string;
  name: string | null;
  original: string;
  valid: boolean;
}

const PHONE_HEADERS = ['telefone', 'phone', 'numero', 'número', 'celular', 'whatsapp', 'fone', 'tel', 'mobile', 'number'];
const NAME_HEADERS = ['nome', 'name', 'contato', 'contact', 'cliente', 'customer'];

function detectColumns(headers: string[]): { phoneIdx: number; nameIdx: number } {
  const lower = headers.map(h => h.toLowerCase().trim());
  let phoneIdx = lower.findIndex(h => PHONE_HEADERS.some(ph => h.includes(ph)));
  let nameIdx = lower.findIndex(h => NAME_HEADERS.some(nh => h.includes(nh)));
  if (phoneIdx === -1) phoneIdx = 0;
  if (nameIdx === -1 && headers.length > 1) nameIdx = phoneIdx === 0 ? 1 : 0;
  return { phoneIdx, nameIdx };
}

function detectSeparator(firstLine: string): string {
  const counts = { ';': 0, ',': 0, '\t': 0 };
  for (const ch of firstLine) {
    if (ch in counts) counts[ch as keyof typeof counts]++;
  }
  if (counts['\t'] > 0) return '\t';
  if (counts[';'] >= counts[',']) return ';';
  return ',';
}

function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  if (digits.startsWith('55')) {
    const nat = digits.substring(2);
    if (nat.length < 10 || nat.length > 11) return null;
  }
  if (digits.length < 12 || digits.length > 15) return null;
  return digits;
}

function parseCSVTXT(text: string): ParsedContact[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];

  const sep = detectSeparator(lines[0]);
  const firstRow = lines[0].split(sep);
  const hasHeader = firstRow.some(cell => PHONE_HEADERS.some(ph => cell.toLowerCase().trim().includes(ph)));

  const { phoneIdx, nameIdx } = hasHeader
    ? detectColumns(firstRow)
    : { phoneIdx: 0, nameIdx: firstRow.length > 1 ? 1 : -1 };

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const seen = new Set<string>();
  const results: ParsedContact[] = [];

  for (const line of dataLines) {
    const cols = line.split(sep).map(c => c.trim().replace(/^["']|["']$/g, ''));
    const rawPhone = cols[phoneIdx] || '';
    if (!rawPhone) continue;
    const normalized = normalizePhone(rawPhone);
    if (normalized && seen.has(normalized)) continue;
    if (normalized) seen.add(normalized);
    results.push({
      phone: normalized || rawPhone,
      name: nameIdx >= 0 ? cols[nameIdx] || null : null,
      original: rawPhone,
      valid: !!normalized,
    });
  }
  return results;
}

function parseXLSX(buffer: ArrayBuffer): ParsedContact[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (rows.length === 0) return [];

  const firstRow = rows[0].map(String);
  const hasHeader = firstRow.some(cell => PHONE_HEADERS.some(ph => cell.toLowerCase().trim().includes(ph)));
  const { phoneIdx, nameIdx } = hasHeader ? detectColumns(firstRow) : { phoneIdx: 0, nameIdx: firstRow.length > 1 ? 1 : -1 };

  const dataRows = hasHeader ? rows.slice(1) : rows;
  const seen = new Set<string>();
  const results: ParsedContact[] = [];

  for (const row of dataRows) {
    const rawPhone = String(row[phoneIdx] || '').trim();
    if (!rawPhone) continue;
    const normalized = normalizePhone(rawPhone);
    if (normalized && seen.has(normalized)) continue;
    if (normalized) seen.add(normalized);
    results.push({
      phone: normalized || rawPhone,
      name: nameIdx >= 0 ? String(row[nameIdx] || '').trim() || null : null,
      original: rawPhone,
      valid: !!normalized,
    });
  }
  return results;
}

export function FileImportDialog({ open, onOpenChange, userId, lists, onSuccess }: FileImportDialogProps) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedContact[]>([]);
  const [step, setStep] = useState<'upload' | 'preview' | 'importing'>('upload');
  const [listMode, setListMode] = useState<'new' | 'existing'>('new');
  const [newListName, setNewListName] = useState('');
  const [targetListId, setTargetListId] = useState('');
  const [progress, setProgress] = useState(0);

  const reset = () => {
    setStep('upload'); setParsed([]); setFileName(''); setProgress(0);
    setNewListName(''); setTargetListId(''); setListMode('new');
  };

  const processFile = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    setFileName(file.name);
    setNewListName(file.name.replace(/\.[^.]+$/, ''));

    try {
      let contacts: ParsedContact[];
      if (ext === 'xlsx' || ext === 'xls') {
        const buffer = await file.arrayBuffer();
        contacts = parseXLSX(buffer);
      } else {
        const text = await file.text();
        contacts = parseCSVTXT(text);
      }

      if (contacts.length === 0) {
        toast({ title: 'Arquivo vazio', description: 'Nenhum contato encontrado no arquivo.', variant: 'destructive' });
        return;
      }
      setParsed(contacts);
      setStep('preview');
    } catch (err: any) {
      toast({ title: 'Erro ao ler arquivo', description: err.message, variant: 'destructive' });
    }
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const validCount = parsed.filter(c => c.valid).length;
  const invalidCount = parsed.filter(c => !c.valid).length;

  const handleImport = async () => {
    if (validCount === 0) return;
    setStep('importing'); setProgress(10);

    try {
      let listId = targetListId;

      if (listMode === 'new') {
        const name = newListName.trim() || fileName.replace(/\.[^.]+$/, '');
        const { data: newList, error } = await supabase
          .from('wa_contact_lists')
          .insert({ user_id: userId, name, source: 'import', contact_count: 0 })
          .select('id').single();
        if (error) throw error;
        listId = newList.id;
      }

      setProgress(30);

      const validContacts = parsed.filter(c => c.valid).map(c => ({
        phone: c.phone,
        name: c.name,
        source: 'import',
      }));

      const { data, error } = await supabase.functions.invoke('sanitize-contacts', {
        body: {
          user_id: userId,
          list_id: listId,
          contacts: validContacts,
          source: 'import',
        },
      });

      setProgress(90);

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao importar');

      setProgress(100);
      const stats = data.stats;
      toast({
        title: 'Importação concluída! ✅',
        description: `${stats.total_valid} contatos importados • ${stats.duplicates_in_db} duplicados ignorados • ${stats.invalid_phones} inválidos`,
      });

      onSuccess();
      setTimeout(() => { onOpenChange(false); reset(); }, 500);
    } catch (err: any) {
      toast({ title: 'Erro na importação', description: err.message, variant: 'destructive' });
      setStep('preview');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Importar Contatos
          </DialogTitle>
          <DialogDescription>
            Envie um arquivo CSV, TXT ou Excel (.xlsx) com números de telefone
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div
            className={`border-2 border-dashed rounded-lg p-10 text-center transition-colors cursor-pointer ${
              dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
            />
            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium">Arraste um arquivo aqui ou clique para selecionar</p>
            <p className="text-sm text-muted-foreground mt-1">
              Formatos aceitos: <Badge variant="secondary">.csv</Badge>{' '}
              <Badge variant="secondary">.txt</Badge>{' '}
              <Badge variant="secondary">.xlsx</Badge>
            </p>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === 'preview' && (
          <div className="space-y-4">
            {/* File info */}
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">{fileName}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={reset}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-3 bg-muted/30 rounded-lg">
                <p className="text-2xl font-bold">{parsed.length}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
              <div className="text-center p-3 bg-green-500/10 rounded-lg">
                <p className="text-2xl font-bold text-green-500">{validCount}</p>
                <p className="text-xs text-muted-foreground">Válidos</p>
              </div>
              <div className="text-center p-3 bg-red-500/10 rounded-lg">
                <p className="text-2xl font-bold text-red-500">{invalidCount}</p>
                <p className="text-xs text-muted-foreground">Inválidos</p>
              </div>
            </div>

            {/* Preview table */}
            <div className="max-h-48 overflow-y-auto border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead className="w-20">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsed.slice(0, 20).map((c, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-sm">{c.phone}</TableCell>
                      <TableCell className="text-sm">{c.name || '—'}</TableCell>
                      <TableCell>
                        {c.valid ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-red-500" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {parsed.length > 20 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  ...e mais {parsed.length - 20} contatos
                </p>
              )}
            </div>

            {/* List selection */}
            <div className="space-y-3">
              <Label>Salvar em</Label>
              <Select value={listMode} onValueChange={(v) => setListMode(v as 'new' | 'existing')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Nova lista</SelectItem>
                  <SelectItem value="existing">Lista existente</SelectItem>
                </SelectContent>
              </Select>

              {listMode === 'new' ? (
                <Input
                  placeholder="Nome da nova lista"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                />
              ) : (
                <Select value={targetListId} onValueChange={setTargetListId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma lista" />
                  </SelectTrigger>
                  <SelectContent>
                    {lists.map(l => (
                      <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Importing */}
        {step === 'importing' && (
          <div className="py-8 space-y-4 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="font-medium">Importando {validCount} contatos...</p>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {step === 'preview' && (
          <DialogFooter>
            <Button variant="outline" onClick={reset}>Cancelar</Button>
            <Button
              onClick={handleImport}
              disabled={validCount === 0 || (listMode === 'existing' && !targetListId) || (listMode === 'new' && !newListName.trim())}
            >
              <Upload className="h-4 w-4 mr-2" />
              Importar {validCount} contatos
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
