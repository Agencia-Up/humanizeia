// =============================================================================
// BNDV FALLBACK — IT-2.3 (qualificação do Pedro SDR)
// =============================================================================
//
// Resolve o bug "Pedro nega estoque" relatado no benchmark Roberta.
//
// PROBLEMA: cliente pede "Strada cabine dupla flex manual 2023". BNDV pode
// não ter NADA com TODOS esses filtros, mas tem Strada CD 2023 flex automática
// — uma alternativa razoável. Agente atual responde "não temos" e fecha porta.
//
// SOLUÇÃO: quando primeira busca retorna 0 itens, relaxar filtros
// progressivamente (do menos importante pro mais importante) até encontrar
// algo. Resultado é marcado como `is_fallback_suggestion=true` pra o LLM
// apresentar como "alternativa" (não como o que pediu literalmente).
//
// ORDEM DE RELAXAÇÃO (mantém marca+modelo até o fim — mudar de Honda pra Fiat
// não é "similar"):
//   1. remove cor
//   2. remove cor + câmbio
//   3. remove cor + câmbio + combustível
//   4. remove cor + câmbio + combustível + versão
//   5. remove cor + câmbio + combustível + versão + ano (só marca+modelo)
//
// USO (fonte canônica testável):
//   ```ts
//   import { relaxBndvFilters } from './bndvFallback';
//   const attempts = relaxBndvFilters({ marca: 'Honda', modelo: 'Civic',
//                                       cor: 'Preto', ano_min: 2023 });
//   for (const attempt of attempts) {
//     const items = applyFilters(vehicles, attempt.filters);
//     if (items.length > 0) return { items, fallback: attempt };
//   }
//   ```
//
// IMPORTANTE: fonte canônica + testes vitest. O webhook
// `uazapi-webhook/index.ts` tem cópia INLINE — qualquer mudança aqui
// precisa ser refletida lá.
// =============================================================================

export type BndvFilters = {
  marca?: string;
  modelo?: string;
  versao?: string;
  combustivel?: string;
  cambio?: string;
  cor?: string;
  ano_min?: number;
  ano_max?: number;
  preco_max?: number;
  km_max?: number;
  query?: string;
};

export type RelaxAttempt = {
  /** Filtros após relaxação. */
  filters: BndvFilters;
  /** Texto descrevendo o que foi removido (pra log + contexto pro LLM). */
  description: string;
  /** Nível 0 = relaxação leve, 5 = só marca+modelo. */
  level: number;
};

/**
 * Gera tentativas progressivamente mais relaxadas. NÃO inclui o filtro
 * original (que já falhou). Retorna ordem: leve → intermediária → agressiva.
 *
 * Filtros que NÃO existiam no original são preservados como undefined.
 * Se `marca`+`modelo` também estão ausentes, retorna [] (sem o que relaxar).
 */
export function relaxBndvFilters(filters: BndvFilters): RelaxAttempt[] {
  // Se nada além de marca/modelo, sem fallback útil possível
  const hasRelaxable =
    !!filters.cor ||
    !!filters.cambio ||
    !!filters.combustivel ||
    !!filters.versao ||
    filters.ano_min !== undefined ||
    filters.ano_max !== undefined;
  if (!hasRelaxable) return [];

  const base: BndvFilters = { ...filters };
  const attempts: RelaxAttempt[] = [];

  // Nível 1: remove cor
  if (filters.cor) {
    const f = { ...base, cor: undefined };
    attempts.push({
      filters: f,
      description: "removendo filtro de cor",
      level: 1,
    });
  }

  // Nível 2: remove cor + câmbio
  if (filters.cor || filters.cambio) {
    const f = { ...base, cor: undefined, cambio: undefined };
    attempts.push({
      filters: f,
      description: "removendo cor e tipo de câmbio",
      level: 2,
    });
  }

  // Nível 3: remove cor + câmbio + combustível
  if (filters.cor || filters.cambio || filters.combustivel) {
    const f = {
      ...base,
      cor: undefined,
      cambio: undefined,
      combustivel: undefined,
    };
    attempts.push({
      filters: f,
      description: "removendo cor, câmbio e combustível",
      level: 3,
    });
  }

  // Nível 4: + remove versão
  if (filters.cor || filters.cambio || filters.combustivel || filters.versao) {
    const f = {
      ...base,
      cor: undefined,
      cambio: undefined,
      combustivel: undefined,
      versao: undefined,
    };
    attempts.push({
      filters: f,
      description: "removendo configurações específicas (versão, câmbio, etc.)",
      level: 4,
    });
  }

  // Nível 5: só marca + modelo (último resort)
  const f = {
    marca: filters.marca,
    modelo: filters.modelo,
    query: filters.query,
  };
  attempts.push({
    filters: f,
    description: "buscando qualquer versão da marca + modelo",
    level: 5,
  });

  // Dedupe: tentativas que ficaram idênticas a outras (ex: original já não tinha
  // versão, então nível 3 e 4 viram iguais)
  const seen = new Set<string>();
  const deduped: RelaxAttempt[] = [];
  for (const a of attempts) {
    const key = JSON.stringify({
      marca: a.filters.marca,
      modelo: a.filters.modelo,
      versao: a.filters.versao,
      cambio: a.filters.cambio,
      combustivel: a.filters.combustivel,
      cor: a.filters.cor,
      ano_min: a.filters.ano_min,
      ano_max: a.filters.ano_max,
    });
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(a);
  }

  return deduped;
}

/**
 * Helper: tenta cada relaxação chamando `searchFn(filters)` até obter > 0
 * resultados. Retorna o primeiro match com info do fallback.
 */
export async function trySimilarVehiclesFallback<TItem>(
  originalFilters: BndvFilters,
  searchFn: (filters: BndvFilters) => Promise<TItem[]>
): Promise<{ items: TItem[]; fallback: RelaxAttempt } | null> {
  const attempts = relaxBndvFilters(originalFilters);
  for (const attempt of attempts) {
    const items = await searchFn(attempt.filters);
    if (items.length > 0) {
      return { items, fallback: attempt };
    }
  }
  return null;
}
