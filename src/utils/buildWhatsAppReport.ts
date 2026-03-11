// WhatsApp report builder - uses direct Meta Ads metrics

interface ReportParams {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm?: number;
  reach?: number;
  frequency?: number;
}

const fmtCur = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(n);

const fmtCurShort = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);

export function buildWhatsAppReport(params: ReportParams): string {
  const { spend, impressions, clicks, ctr, cpc, cpm, reach, frequency } = params;

  const lines: string[] = [];

  lines.push(`📊 *RELATÓRIO META ADS*`);
  lines.push(``);
  lines.push(`💰 *MÉTRICAS DE PERFORMANCE*`);
  lines.push(``);
  lines.push(`Investimento: ${fmtCurShort(spend)}`);
  lines.push(`Impressões: ${impressions.toLocaleString('pt-BR')}`);
  lines.push(`Cliques: ${clicks.toLocaleString('pt-BR')}`);
  lines.push(`CTR: ${ctr.toFixed(2)}%`);
  lines.push(`CPC: ${fmtCur(cpc)}`);
  lines.push(``);

  if (cpm !== undefined || reach !== undefined) {
    lines.push(`📈 *DETALHES*`);
    lines.push(``);
    if (cpm !== undefined) lines.push(`CPM: ${fmtCur(cpm)}`);
    if (reach !== undefined) lines.push(`Alcance: ${reach.toLocaleString('pt-BR')}`);
    if (frequency !== undefined) lines.push(`Frequência: ${frequency.toFixed(1)}`);
    lines.push(``);
  }

  lines.push(`✅ Relatório gerado por Apollo AI`);

  return lines.join('\n');
}
