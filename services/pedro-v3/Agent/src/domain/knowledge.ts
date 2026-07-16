import type { TenantAgentRef } from "./read-ports.ts";

export type KnowledgeProvenance = "core_semantics" | "tenant_knowledge";

export type KnowledgeChunk = {
  readonly id: string;
  readonly sourceId: string | null;
  readonly title: string | null;
  readonly content: string;
  readonly confidence: number;
  readonly provenance: KnowledgeProvenance;
};

export type KnowledgeSearchResult = {
  readonly chunks: readonly KnowledgeChunk[];
  readonly confidence: number;
};

export type KnowledgeGap = {
  readonly query: string;
  readonly quote: string;
  readonly reason: string;
};

/**
 * Read-only semantic reference. It describes meanings and boundaries between
 * concepts; it does not classify a lead, select a tool, or write a reply.
 */
export interface KnowledgeSource {
  search(ref: TenantAgentRef, query: string, limit: number): Promise<KnowledgeSearchResult>;
}

const CORE_ENTRIES: readonly KnowledgeChunk[] = [
  {
    id: "core:vehicle-roles",
    sourceId: null,
    title: "Papéis de veículos na conversa",
    content: "Separe semanticamente: veículo pretendido é o carro que o lead quer comprar; veículo de troca é o carro que o lead possui e oferece; veículo selecionado ou anunciado é uma referência a um item do estoque já apresentado. Um modelo, ano, cor ou quilometragem informados pelo lead podem descrever o veículo de troca e não significam busca no estoque por si só.",
    confidence: 0.98,
    provenance: "core_semantics",
  },
  {
    id: "core:payment-roles",
    sourceId: null,
    title: "Papéis financeiros",
    content: "Separe forma de pagamento, instrumento de crédito, entrada, parcela e orçamento. Consórcio e carta de consórcio contemplada são forma ou instrumento de pagamento. O valor de uma carta contemplada não é automaticamente entrada, parcela, preço máximo ou orçamento; o papel do valor depende do que o lead disse no bloco atual.",
    confidence: 0.99,
    provenance: "core_semantics",
  },
  {
    id: "core:automotive-language",
    sourceId: null,
    title: "Linguagem automotiva e financeira",
    content: "Erros de escrita, abreviações, mensagens sem pontuação e mensagens fragmentadas devem ser interpretados pelo sentido do bloco lógico e pelo contexto recente. Termos como km, ano, cor, automático, manual, troca, entrada, parcela, financiamento, consórcio e carta descrevem fatos diferentes e devem permanecer em seus papéis sem contaminar estoque ou interesse de compra.",
    confidence: 0.96,
    provenance: "core_semantics",
  },
  {
    id: "core:unknown-facts",
    sourceId: null,
    title: "Fato desconhecido",
    content: "Conhecimento semântico explica conceitos gerais. Fatos específicos da loja, veículos atuais, preços, condições, aprovação, prazos, políticas comerciais e disponibilidade só podem vir do prompt do portal, da memória factual atual ou de uma ferramenta aterrada. Quando não houver fonte suficiente, a LLM deve admitir a lacuna e decidir se pergunta, consulta uma fonte autorizada ou registra o ponto para o vendedor.",
    confidence: 0.97,
    provenance: "core_semantics",
  },
];

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
}

function tokens(text: string): readonly string[] {
  return [...new Set(normalize(text).split(/[^a-z0-9]+/).filter((token) => token.length >= 3))];
}

/** Cheap deterministic fallback for the built-in glossary; retrieval only. */
export class CoreSemanticKnowledgeSource implements KnowledgeSource {
  async search(_ref: TenantAgentRef, query: string, limit: number): Promise<KnowledgeSearchResult> {
    const queryTokens = new Set(tokens(query));
    if (queryTokens.size === 0) return { chunks: [], confidence: 0 };
    const ranked = CORE_ENTRIES.map((entry) => {
      const entryTokens = new Set(tokens(`${entry.title ?? ""} ${entry.content}`));
      const overlap = [...queryTokens].filter((token) => entryTokens.has(token)).length;
      return { entry, score: overlap / Math.max(queryTokens.size, 1) };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
    const chunks = ranked.slice(0, Math.max(0, Math.min(limit, 8))).map(({ entry, score }) => ({ ...entry, confidence: Math.max(entry.confidence * score, 0.01) }));
    return { chunks, confidence: chunks.length > 0 ? chunks[0].confidence : 0 };
  }
}

export class CompositeKnowledgeSource implements KnowledgeSource {
  private readonly core = new CoreSemanticKnowledgeSource();

  constructor(private readonly tenant: KnowledgeSource | null = null) {}

  async search(ref: TenantAgentRef, query: string, limit: number): Promise<KnowledgeSearchResult> {
    const [core, tenant] = await Promise.all([
      this.core.search(ref, query, limit),
      this.tenant?.search(ref, query, limit).catch((): KnowledgeSearchResult => ({ chunks: [], confidence: 0 })) ?? Promise.resolve({ chunks: [], confidence: 0 }),
    ]);
    const seen = new Set<string>();
    const chunks = [...tenant.chunks, ...core.chunks]
      .filter((chunk) => !seen.has(chunk.id) && (seen.add(chunk.id), true))
      .slice(0, Math.max(0, Math.min(limit, 8)));
    return { chunks, confidence: chunks.length > 0 ? Math.max(...chunks.map((chunk) => chunk.confidence)) : 0 };
  }
}
