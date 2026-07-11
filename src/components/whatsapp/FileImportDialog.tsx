import { useState, useCallback, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { resolveFirstMarcosStageId as ensureFirstMarcosStageId } from '@/lib/marcosCrmStages';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileSpreadsheet, FileText, CheckCircle, AlertCircle, Loader2, X } from 'lucide-react';
import * as XLSX from 'xlsx';

interface FileImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  lists: { id: string; name: string }[];
  onSuccess: () => void;
  /** Quando vendedor importa: vincula a lista criada a ele (senão some da visão dele). */
  isSeller?: boolean;
  seller?: { id: string; name?: string | null } | null;
  teamMembers?: ImportSeller[];
}

interface ImportSeller {
  id: string;
  name: string | null;
  whatsapp_number?: string | null;
  active_in_system?: boolean | null;
}

interface ParsedContact {
  phone: string;
  name: string | null;
  original: string;
  phoneValid: boolean;
  valid: boolean;
  sellerRaw?: string | null;
  sellerId?: string | null;
  sellerName?: string | null;
  sellerError?: string | null;
}

const PHONE_HEADERS = ['telefone', 'phone', 'numero', 'número', 'celular', 'whatsapp', 'fone', 'tel', 'mobile', 'number'];
const NAME_HEADERS = ['nome', 'name', 'contato', 'contact', 'cliente', 'customer'];
const SELLER_HEADERS = ['vendedor', 'responsavel', 'responsavel', 'responsavel', 'consultor', 'atendente', 'seller'];

function normalizeText(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function detectColumns(headers: string[]): { phoneIdx: number; nameIdx: number; sellerIdx: number } {
  const lower = headers.map(normalizeText);
  let phoneIdx = lower.findIndex(h => PHONE_HEADERS.some(ph => h.includes(ph)));
  let nameIdx = lower.findIndex(h => NAME_HEADERS.some(nh => h.includes(nh)));
  let sellerIdx = lower.findIndex(h => SELLER_HEADERS.some(sh => h.includes(normalizeText(sh))));
  if (phoneIdx === -1) phoneIdx = 0;
  if (nameIdx === -1 && headers.length > 1) nameIdx = phoneIdx === 0 ? 1 : 0;
  return { phoneIdx, nameIdx, sellerIdx };
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

  const { phoneIdx, nameIdx, sellerIdx } = hasHeader
    ? detectColumns(firstRow)
    : { phoneIdx: 0, nameIdx: firstRow.length > 1 ? 1 : -1, sellerIdx: -1 };

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
      phoneValid: !!normalized,
      valid: !!normalized,
      sellerRaw: sellerIdx >= 0 ? cols[sellerIdx] || null : null,
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
  const { phoneIdx, nameIdx, sellerIdx } = hasHeader
    ? detectColumns(firstRow)
    : { phoneIdx: 0, nameIdx: firstRow.length > 1 ? 1 : -1, sellerIdx: -1 };

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
      phoneValid: !!normalized,
      valid: !!normalized,
      sellerRaw: sellerIdx >= 0 ? String(row[sellerIdx] || '').trim() || null : null,
    });
  }
  return results;
}

export function FileImportDialog({ open, onOpenChange, userId, lists, onSuccess, isSeller, seller, teamMembers = [] }: FileImportDialogProps) {
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

  const availableSellers = useMemo(
    () => teamMembers.filter(m => m.active_in_system !== false && m.id),
    [teamMembers]
  );
  const canAssignSeller = !isSeller && availableSellers.length > 0;

  const findSellerByText = useCallback((raw?: string | null) => {
    const needle = normalizeText(raw || '');
    if (!needle) return null;
    return availableSellers.find(s => {
      const name = normalizeText(s.name || '');
      const phone = String(s.whatsapp_number || '').replace(/\D/g, '');
      return name === needle || name.includes(needle) || needle.includes(name) || (!!phone && needle.includes(phone));
    }) || null;
  }, [availableSellers]);

  const hydrateSellers = useCallback((contacts: ParsedContact[]) => {
    if (!canAssignSeller) return contacts;
    return contacts.map(c => {
      if (!c.sellerRaw) return { ...c, sellerId: null, sellerName: null, sellerError: null };
      const matched = findSellerByText(c.sellerRaw);
      const sellerError = matched ? null : `Vendedor nao encontrado: ${c.sellerRaw}`;
      return {
        ...c,
        sellerId: matched?.id || null,
        sellerName: matched?.name || null,
        sellerError,
        valid: c.phoneValid && !sellerError,
      };
    });
  }, [canAssignSeller, findSellerByText]);

  const applySellerToAll = useCallback((sellerId: string) => {
    const selected = sellerId === 'unassigned'
      ? null
      : availableSellers.find(s => s.id === sellerId) || null;
    setParsed(prev => prev.map(c => ({
      ...c,
      sellerId: selected?.id || null,
      sellerName: selected?.name || null,
      sellerError: null,
      valid: c.phoneValid,
    })));
  }, [availableSellers]);

  const updateContactSeller = useCallback((index: number, sellerId: string) => {
    const selected = sellerId === 'unassigned'
      ? null
      : availableSellers.find(s => s.id === sellerId) || null;
    setParsed(prev => prev.map((c, i) => i === index
      ? {
          ...c,
          sellerId: selected?.id || null,
          sellerName: selected?.name || null,
          sellerError: null,
          valid: c.phoneValid,
        }
      : c
    ));
  }, [availableSellers]);

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
      setParsed(hydrateSellers(contacts));
      setStep('preview');
    } catch (err: any) {
      toast({ title: 'Erro ao ler arquivo', description: err.message, variant: 'destructive' });
    }
  }, [hydrateSellers, toast]);

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

  const crmPhoneFromContact = (phone: string) => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.startsWith('55')) {
      const national = digits.slice(2);
      if (national.length === 10 || national.length === 11) return national;
    }
    return digits;
  };

  const crmPhoneCandidates = (phone: string) => {
    const national = crmPhoneFromContact(phone);
    const withCountry = national.startsWith('55') ? national : `55${national}`;
    return Array.from(new Set([national, withCountry].filter(Boolean)));
  };

  const resolveFirstMarcosStageId = async () => {
    return ensureFirstMarcosStageId(supabase as any, userId);
  };

  const createAssignedCrmLeads = async (listId: string) => {
    const assignedContacts = parsed
      .filter(c => c.valid)
      .map(c => {
        const selectedSellerId = c.sellerId || ((isSeller && seller?.id) ? seller.id : null);
        if (!selectedSellerId) return null;
        const selectedSeller = availableSellers.find(s => s.id === selectedSellerId) || null;
        return {
          contact: c,
          sellerId: selectedSellerId,
          sellerName: selectedSeller?.name || c.sellerName || seller?.name || 'Vendedor',
          phone: crmPhoneFromContact(c.phone),
        };
      })
      .filter(Boolean) as Array<{ contact: ParsedContact; sellerId: string; sellerName: string; phone: string }>;

    if (assignedContacts.length === 0) return 0;

    const allCandidatePhones = Array.from(new Set(assignedContacts.flatMap(item => crmPhoneCandidates(item.contact.phone))));
    const existingPhones = new Set<string>();
    for (let i = 0; i < allCandidatePhones.length; i += 100) {
      const chunk = allCandidatePhones.slice(i, i + 100);
      const { data, error } = await (supabase as any)
        .from('crm_leads')
        .select('phone')
        .eq('user_id', userId)
        .in('phone', chunk);
      if (error) throw error;
      for (const row of (data || [])) {
        for (const candidate of crmPhoneCandidates(row.phone)) existingPhones.add(candidate);
      }
    }

    const firstStageId = await resolveFirstMarcosStageId();
    const { data: maxPosRow } = await (supabase as any)
      .from('crm_leads')
      .select('position')
      .eq('user_id', userId)
      .eq('stage_id', firstStageId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextPosition = (maxPosRow?.position ?? -1) + 1;

    const rows = assignedContacts
      .filter(item => !crmPhoneCandidates(item.contact.phone).some(candidate => existingPhones.has(candidate)))
      .map(item => ({
        user_id: userId,
        stage_id: firstStageId,
        name: item.contact.name || item.contact.phone,
        phone: item.phone,
        source: 'importacao_contatos',
        origem: 'outros',
        notes: null,
        tags: ['Marcos Contatos', 'Importado'],
        value: 0,
        currency: 'BRL',
        priority: 'medium',
        position: nextPosition++,
        assigned_to: item.sellerId,
        custom_fields: {
          crm_owner: 'marcos',
          input_mode: 'contacts_import',
          list_id: listId,
          seller_member_id: item.sellerId,
          seller_name: item.sellerName,
        },
      }));

    if (rows.length === 0) return 0;
    for (let i = 0; i < rows.length; i += 50) {
      const { error } = await (supabase as any).from('crm_leads').insert(rows.slice(i, i + 50));
      if (error) throw error;
    }
    return rows.length;
  };

  const handleImport = async () => {
    if (validCount === 0) return;
    setStep('importing'); setProgress(10);

    try {
      let listId = targetListId;
      const selectedSellerIds = new Set(parsed.filter(c => c.valid && c.sellerId).map(c => c.sellerId as string));
      const listSellerId = (isSeller && seller?.id)
        ? seller.id
        : selectedSellerIds.size === 1
          ? Array.from(selectedSellerIds)[0]
          : null;

      if (listMode === 'new') {
        const name = newListName.trim() || fileName.replace(/\.[^.]+$/, '');
        const { data: newList, error } = await supabase
          .from('wa_contact_lists')
          .insert({
            user_id: userId,
            name,
            source: 'import',
            contact_count: 0,
            // vendedor importando -> lista vinculada a ele (senão fica invisível na visão dele).
            seller_member_id: listSellerId,
          } as any)
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

      const crmCreated = await createAssignedCrmLeads(listId);

      setProgress(100);
      const stats = data.stats;
      toast({
        title: 'Importação concluída! ✅',
        description: `${stats.total_valid} contatos importados • ${stats.duplicates_in_db} duplicados ignorados • ${stats.invalid_phones} inválidos${crmCreated ? ` • ${crmCreated} lead(s) no CRM` : ''}`,
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

            {canAssignSeller && (
              <div className="space-y-2 rounded-lg border border-green-500/30 bg-green-500/10 p-3">
                <Label>Vendedor no CRM</Label>
                <Select onValueChange={applySellerToAll}>
                  <SelectTrigger>
                    <SelectValue placeholder="Aplicar vendedor para todos os contatos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Sem vendedor</SelectItem>
                    {availableSellers.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name || 'Vendedor'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Se a planilha tiver uma coluna "Vendedor", ela sera lida automaticamente. Voce tambem pode ajustar por linha antes de importar.
                </p>
              </div>
            )}

            {/* Preview table */}
            <div className="max-h-64 overflow-y-auto border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Nome</TableHead>
                    {canAssignSeller && <TableHead>Vendedor</TableHead>}
                    <TableHead className="w-20">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsed.slice(0, 20).map((c, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-sm">{c.phone}</TableCell>
                      <TableCell className="text-sm">{c.name || '—'}</TableCell>
                      {canAssignSeller && (
                        <TableCell className="min-w-48">
                          <Select value={c.sellerId || 'unassigned'} onValueChange={(value) => updateContactSeller(i, value)}>
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="Sem vendedor" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unassigned">Sem vendedor</SelectItem>
                              {availableSellers.map(s => (
                                <SelectItem key={s.id} value={s.id}>{s.name || 'Vendedor'}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {c.sellerError && <p className="mt-1 text-[11px] text-red-500">{c.sellerError}</p>}
                        </TableCell>
                      )}
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
