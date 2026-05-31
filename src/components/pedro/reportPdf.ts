// ============================================================================
// reportPdf — Exportação em PDF dos relatórios do Pedro (Tráfego + Qualificação)
// ----------------------------------------------------------------------------
// Mesmo conteúdo do CSV, porém num PDF formatado e pronto pra enviar ao gestor
// de tráfego pago / gerente.
//
// jspdf + jspdf-autotable são carregados via import() DINÂMICO: a biblioteca só
// é baixada quando o usuário clica em "Exportar PDF". Assim ela NÃO entra no
// bundle inicial do site (carregamento da página continua leve).
// ============================================================================

export interface PdfColumn {
  header: string;
  align?: 'left' | 'right' | 'center';
}

export interface PdfReportOptions {
  /** Título grande no topo do PDF. */
  title: string;
  /** Subtítulo (ex.: "Período: 30 dias"). */
  subtitle?: string;
  /** Nome do arquivo SEM extensão (.pdf é adicionado). */
  filename: string;
  /** Cabeçalho das colunas. */
  columns: PdfColumn[];
  /** Linhas de dados (mesma ordem das colunas). */
  rows: Array<Array<string | number>>;
  /** Linha de TOTAL (renderizada em negrito no rodapé da tabela). */
  totalRow?: Array<string | number>;
  /** Nota pequena abaixo da tabela (explicação/cobertura de dados). */
  note?: string;
  /** Cor de destaque do cabeçalho da tabela (RGB). Default: azul. */
  accentRgb?: [number, number, number];
  /** Orientação da página. Tabelas largas → 'landscape'. Default: 'portrait'. */
  orientation?: 'portrait' | 'landscape';
}

export async function downloadReportPdf(opts: PdfReportOptions): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const accent: [number, number, number] = opts.accentRgb ?? [37, 99, 235]; // blue-600
  const doc = new jsPDF({ orientation: opts.orientation ?? 'portrait', unit: 'pt', format: 'a4' });
  const marginX = 40;
  let y = 46;

  // ── Cabeçalho ──────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(17, 24, 39);
  doc.text(opts.title, marginX, y);
  y += 17;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128);
  if (opts.subtitle) { doc.text(opts.subtitle, marginX, y); y += 13; }
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, marginX, y);

  // ── Corpo da tabela (+ linha de total) ───────────────────────────────────────
  const body: string[][] = opts.rows.map(r => r.map(c => String(c ?? '')));
  if (opts.totalRow) body.push(opts.totalRow.map(c => String(c ?? '')));
  const totalRowIndex = opts.totalRow ? body.length - 1 : -1;

  const columnStyles: Record<number, { halign: 'left' | 'right' | 'center' }> = {};
  opts.columns.forEach((c, i) => { columnStyles[i] = { halign: c.align ?? 'left' }; });

  autoTable(doc, {
    startY: y + 12,
    head: [opts.columns.map(c => c.header)],
    body,
    styles: { fontSize: 9, cellPadding: 5, textColor: [31, 41, 55], lineColor: [229, 231, 235], lineWidth: 0.5 },
    headStyles: { fillColor: accent, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'left' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles,
    margin: { left: marginX, right: marginX },
    didParseCell: (d) => {
      // Linha de TOTAL em negrito com fundo cinza-claro.
      if (totalRowIndex >= 0 && d.section === 'body' && d.row.index === totalRowIndex) {
        d.cell.styles.fontStyle = 'bold';
        d.cell.styles.fillColor = [241, 245, 249];
      }
    },
  });

  // ── Nota de rodapé ──────────────────────────────────────────────────────────
  if (opts.note) {
    const finalY = (doc as any).lastAutoTable?.finalY ?? (y + 60);
    const maxW = doc.internal.pageSize.getWidth() - marginX * 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text(doc.splitTextToSize(opts.note, maxW), marginX, finalY + 18);
  }

  doc.save(`${opts.filename}.pdf`);
}
