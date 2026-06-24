// Extrai TEXTO de um arquivo no NAVEGADOR (a base de conhecimento só usa texto pros embeddings).
// Libs pesadas (pdf.js, mammoth, xlsx) são carregadas SOB DEMANDA (dynamic import) — só baixam
// quando o usuário sobe um arquivo daquele tipo, sem pesar o resto do site.

export interface ExtractResult {
  text: string;
  supported: boolean;   // false = tipo sem texto (imagem/vídeo/binário)
  error?: string;
}

const TEXT_EXTS = ['txt', 'csv', 'tsv', 'md', 'markdown', 'json', 'log', 'html', 'htm', 'xml', 'yml', 'yaml', 'rtf'];

async function extractPdf(file: File): Promise<string> {
  const pdfjs: any = await import('pdfjs-dist');
  // worker bundlado pelo Vite (?url) — carregado junto, só quando há PDF.
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const partes: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    partes.push((content.items as any[]).map((it) => (it && 'str' in it ? it.str : '')).join(' '));
  }
  await pdf.destroy?.();
  return partes.join('\n').trim();
}

async function extractDocx(file: File): Promise<string> {
  const mammoth: any = await import('mammoth');
  const fn = mammoth.extractRawText || mammoth.default?.extractRawText;
  const buf = await file.arrayBuffer();
  const res = await fn({ arrayBuffer: buf });
  return String(res?.value || '').trim();
}

async function extractXlsx(file: File): Promise<string> {
  const XLSX: any = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const partes: string[] = [];
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
    if (csv.trim()) partes.push(`## ${name}\n${csv}`);
  }
  return partes.join('\n\n').trim();
}

export async function extractFileText(file: File): Promise<ExtractResult> {
  const name = (file.name || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop()! : '';
  const mime = (file.type || '').toLowerCase();
  try {
    if (TEXT_EXTS.includes(ext) || mime.startsWith('text/') || mime === 'application/json') {
      return { text: (await file.text()).trim(), supported: true };
    }
    if (ext === 'xlsx' || ext === 'xls' || mime.includes('spreadsheet') || mime.includes('excel')) {
      return { text: await extractXlsx(file), supported: true };
    }
    if (ext === 'pdf' || mime === 'application/pdf') {
      return { text: await extractPdf(file), supported: true };
    }
    if (ext === 'docx' || mime.includes('wordprocessingml')) {
      return { text: await extractDocx(file), supported: true };
    }
    // .doc antigo (binário) não é lido pelo mammoth.
    if (ext === 'doc') {
      return { text: '', supported: false, error: 'Word antigo (.doc) não é suportado. Salve como .docx ou PDF.' };
    }
    return { text: '', supported: false };
  } catch (e: any) {
    return { text: '', supported: true, error: e?.message || 'Falha ao ler o arquivo.' };
  }
}
