export interface CreativeInsight {
  text: string;
  type: 'positive' | 'warning' | 'negative';
}

export interface CreativeScoreResult {
  score: number;
  insights: CreativeInsight[];
}

export interface CreativeMetadata {
  has_text: boolean;
  has_cta: boolean;
  image_format: string;
  text_length: number;
}

/**
 * Gera um score simulado de performance criativa (0-100) com insights.
 * Placeholder que será substituído por análise real via Vision API.
 */
export function generateCreativeScore(metadata: CreativeMetadata): CreativeScoreResult {
  let score = 50;
  const insights: CreativeInsight[] = [];

  // --- Texto na imagem ---
  if (metadata.has_text) {
    if (metadata.text_length > 0 && metadata.text_length <= 40) {
      score += 15;
      insights.push({ text: 'Texto equilibrado — tamanho ideal para leitura rápida', type: 'positive' });
    } else if (metadata.text_length > 40 && metadata.text_length <= 90) {
      score += 5;
      insights.push({ text: 'Texto um pouco longo — considere reduzir para maior impacto', type: 'warning' });
    } else if (metadata.text_length > 90) {
      score -= 10;
      insights.push({ text: 'Texto excessivo — criativos com muito texto têm menor alcance', type: 'negative' });
    }
  } else {
    score += 5;
    insights.push({ text: 'Sem texto na imagem — pode funcionar bem para awareness', type: 'warning' });
  }

  // --- CTA ---
  if (metadata.has_cta) {
    score += 15;
    insights.push({ text: 'CTA presente — aumenta a taxa de cliques em até 30%', type: 'positive' });
  } else {
    score -= 5;
    insights.push({ text: 'CTA ausente — adicionar um botão de ação melhora conversões', type: 'negative' });
  }

  // --- Formato ---
  const feedFormats = ['feed-1x1', 'feed-4x5'];
  const storyFormats = ['stories-9x16', 'reels-9x16'];

  if (feedFormats.includes(metadata.image_format)) {
    score += 10;
    insights.push({ text: 'Formato otimizado para Feed — boa visibilidade no scroll', type: 'positive' });
  } else if (storyFormats.includes(metadata.image_format)) {
    score += 10;
    insights.push({ text: 'Formato vertical — ideal para Stories e Reels', type: 'positive' });
  } else if (metadata.image_format === 'landscape-16x9') {
    score += 5;
    insights.push({ text: 'Formato paisagem — melhor para YouTube e Display', type: 'warning' });
  } else {
    score += 0;
    insights.push({ text: 'Formato de display — verifique se combina com o canal de veiculação', type: 'warning' });
  }

  // --- Regras de contraste e composição simuladas ---
  const contrastRoll = Math.random();
  if (contrastRoll > 0.4) {
    score += 10;
    insights.push({ text: 'Contraste de cores ideal — elementos se destacam bem', type: 'positive' });
  } else {
    score -= 5;
    insights.push({ text: 'Contraste pode ser melhorado — texto pode ficar difícil de ler', type: 'warning' });
  }

  // --- Composição visual simulada ---
  if (metadata.has_text && metadata.has_cta) {
    score += 5;
    insights.push({ text: 'Composição completa — texto + CTA + imagem é a combinação mais eficaz', type: 'positive' });
  }

  // Clamp entre 0 e 100
  score = Math.max(0, Math.min(100, score));

  return { score, insights };
}
