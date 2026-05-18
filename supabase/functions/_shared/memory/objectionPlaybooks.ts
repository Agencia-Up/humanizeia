// =============================================================================
// OBJECTION PLAYBOOKS — IT-3.3 (memória do Pedro SDR)
// =============================================================================
//
// Lista hardcoded (Opção B) das 8 objeções mais comuns em revenda automotiva
// + estratégia recomendada pra cada uma. Quando o `extractEntitiesWithClaude`
// detecta uma objeção e popula `state.atendimento.objecoes[]`, o webhook
// busca os playbooks correspondentes e apenda no system prompt.
//
// MOTIVAÇÃO: hoje o agente recebe a objeção no state ("nao_pode_visitar",
// "esposo_decide", etc.) sem orientação explícita do que fazer. O LLM decide
// caso a caso — às vezes bem, às vezes pressiona ou desiste.
//
// MATCHING: keys aqui DEVEM bater com os valores que o extractEntities
// produz (linha 291 do webhook):
//   "nao_pode_visitar" | "esposo_decide" | "longe" | "nao_quer_financiar" |
//   "orcamento_baixo" | ...
//
// USO (fonte canônica testável):
//   ```ts
//   import { getRelevantPlaybooks, formatObjectionPlaybooksBlock }
//          from './objectionPlaybooks';
//
//   const playbooks = getRelevantPlaybooks(state?.atendimento?.objecoes || []);
//   if (playbooks.length > 0) systemPrompt += '\n\n' + formatObjectionPlaybooksBlock(playbooks);
//   ```
//
// EVOLUÇÃO FUTURA: quando produto crescer, migrar pra tabela
// `pedro_objection_playbooks` com UI de cadastro por master. Hoje
// (Opção B): lista fechada cobrindo 80% dos casos reais.
//
// IMPORTANTE: fonte canônica + testes vitest. O webhook
// `uazapi-webhook/index.ts` tem cópia INLINE — qualquer mudança aqui
// precisa ser refletida lá.
// =============================================================================

export type ObjectionPlaybook = {
  /** Slug compatível com extractEntities. */
  key: string;
  /** Nome humano da objeção. */
  label: string;
  /** Sinais que o cliente costuma dar (pra orientar matching futuro). */
  customer_signals: string[];
  /** Estratégia recomendada — uma linha curta. */
  agent_should: string;
  /** Anti-padrão — o que NUNCA fazer. */
  do_not: string;
  /** 1 exemplo de resposta curta e tonalidade correta. */
  example_response: string;
};

export const OBJECTION_PLAYBOOKS: ObjectionPlaybook[] = [
  {
    key: "nao_pode_visitar",
    label: "Não pode visitar a loja",
    customer_signals: [
      "moro longe",
      "não tenho como ir aí",
      "fica longe pra mim",
      "outra cidade/estado",
    ],
    agent_should:
      "Oferecer atendimento 100% remoto (foto, vídeo, condição via WhatsApp). NÃO insistir em visita.",
    do_not:
      "Repetir convite pra loja, sugerir test drive presencial, perguntar 'que horas pode passar?'",
    example_response:
      "Tranquilo! Conseguimos te atender 100% remoto — foto, vídeo, condição e até fechamento por aqui. Você prefere ver detalhe do modelo que te interessou?",
  },
  {
    key: "longe",
    label: "Cliente distante (variante de não_pode_visitar)",
    customer_signals: ["longe demais", "muito longe", "fora da cidade"],
    agent_should:
      "Mesma estratégia de 'nao_pode_visitar': oferecer fluxo remoto, mostrar que dá pra fechar à distância.",
    do_not: "Insistir em visita, perguntar endereço de novo.",
    example_response:
      "Sem problema, dá pra a gente resolver tudo por aqui. Posso te mandar foto e condição agora — qual modelo te interessa?",
  },
  {
    key: "esposo_decide",
    label: "Esposo/companheiro decide (variante: esposa_decide / pai_decide)",
    customer_signals: [
      "preciso falar com meu marido",
      "minha esposa que decide",
      "vou conversar em casa",
    ],
    agent_should:
      "Respeitar — perguntar quando conseguem decidir juntos, oferecer mandar foto/preço pra ele(a) ver também. NÃO pressionar pra decidir agora.",
    do_not:
      "Tentar fechar sozinho, dizer 'mas o carro pode acabar', minimizar o acompanhante.",
    example_response:
      "Claro, decisão importante mesmo. Quer que eu te mande material pra você mostrar pra ele(a)? Quando tiverem alinhados, é só me chamar.",
  },
  {
    key: "esposa_decide",
    label: "Esposa decide (variante)",
    customer_signals: ["minha esposa que escolhe", "vou ver com minha esposa"],
    agent_should:
      "Mesma estratégia de 'esposo_decide'. Manda material pra mostrar em casa.",
    do_not: "Pressionar pra fechar sem ela, criar falsa urgência.",
    example_response:
      "Beleza! Quer que eu te mande as fotos e o preço bonito pra você mostrar pra ela? Aí decidem juntos.",
  },
  {
    key: "nao_quer_financiar",
    label: "Não quer financiamento (prefere à vista)",
    customer_signals: [
      "não quero financiar",
      "só pago à vista",
      "não gosto de juros",
    ],
    agent_should:
      "Confirmar à vista no estado, focar em valor de tabela e desconto pra pagamento à vista. NÃO oferecer simulação de financiamento.",
    do_not: "Insistir em simular financiamento, perguntar 'mas qual entrada?'",
    example_response:
      "Show, à vista a gente consegue uma condição bem melhor. Vou ver o desconto pra esse modelo — tem outro modelo que tá te interessando junto?",
  },
  {
    key: "orcamento_baixo",
    label: "Orçamento apertado / acha caro",
    customer_signals: [
      "tá caro",
      "fora do meu orçamento",
      "queria mais barato",
      "não tenho tudo isso",
    ],
    agent_should:
      "Perguntar a faixa que cabe no orçamento e oferecer modelo similar mais barato (ou mesmo modelo em ano/versão anterior). Não desistir.",
    do_not:
      "Concordar que tá caro e fechar conversa, ou inventar desconto sem o vendedor.",
    example_response:
      "Entendo! Qual faixa cabe no seu bolso? Tenho opções similares em ano anterior ou versão mais simples que podem encaixar.",
  },
  {
    key: "so_olhando",
    label: "Só olhando / sem urgência",
    customer_signals: ["tô só olhando", "só dando uma olhada", "sem pressa"],
    agent_should:
      "NÃO pressionar. Deixar canal aberto, oferecer mandar atualizações quando aparecer modelo interessante.",
    do_not:
      "Insistir 'mas hoje tem condição especial', criar urgência falsa, perguntar várias vezes.",
    example_response:
      "Tranquilo, quando quiser ver algo é só chamar 👍 Tem modelo específico que você tá de olho pra eu te avisar se aparecer?",
  },
  {
    key: "concorrente_mais_barato",
    label: "Vi mais barato em outra loja",
    customer_signals: [
      "vi por X em outra loja",
      "concorrente tá vendendo por menos",
      "vocês cobrem o preço",
    ],
    agent_should:
      "NÃO depreciar o concorrente. Não prometer cobertura de preço (só o vendedor humano faz). Transferir pro vendedor pra avaliar condição.",
    do_not:
      "Falar mal da outra loja, prometer cobrir preço sem confirmar, dar desconto inventado.",
    example_response:
      "Entendi! Quem analisa cobertura de preço é nosso vendedor presencial. Vou te conectar com ele pra te passar nossa melhor condição.",
  },
];

/**
 * Retorna playbooks relevantes baseado nas objeções já detectadas no state.
 * Faz matching case-insensitive nas keys. Dedupe automático.
 */
export function getRelevantPlaybooks(
  stateObjections: string[]
): ObjectionPlaybook[] {
  if (!Array.isArray(stateObjections) || stateObjections.length === 0) return [];

  const normalized = new Set(
    stateObjections
      .filter((o) => typeof o === "string" && o.trim().length > 0)
      .map((o) => o.trim().toLowerCase())
  );
  if (normalized.size === 0) return [];

  return OBJECTION_PLAYBOOKS.filter((pb) =>
    normalized.has(pb.key.toLowerCase())
  );
}

/**
 * Formata playbooks como bloco markdown pro system prompt. Vazio se nada.
 */
export function formatObjectionPlaybooksBlock(
  playbooks: ObjectionPlaybook[]
): string {
  if (!playbooks || playbooks.length === 0) return "";

  const lines: string[] = [];
  lines.push("## PLAYBOOKS DE OBJEÇÃO (cliente já levantou estas objeções)");
  lines.push("");
  for (const pb of playbooks) {
    lines.push(`### ${pb.label}`);
    lines.push(`- **Faça**: ${pb.agent_should}`);
    lines.push(`- **NUNCA**: ${pb.do_not}`);
    lines.push(`- **Exemplo de resposta**: "${pb.example_response}"`);
    lines.push("");
  }
  lines.push(
    "⚠️ Estes são padrões testados. Siga a estratégia indicada — não improvise nesses casos."
  );
  return lines.join("\n");
}
