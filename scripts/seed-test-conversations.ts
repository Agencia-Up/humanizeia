// =============================================================================
// SEED — 20 conversas sintéticas do Pedro SDR
// =============================================================================
//
// Fixtures realistas (concessionária revenda automotiva via WhatsApp) cobrindo
// os principais cenários do agente. NÃO escreve em banco — apenas exporta o
// array `SYNTHETIC_CONVERSATIONS` pra uso em testes/benchmark/eval.
//
// USO:
//   import { SYNTHETIC_CONVERSATIONS } from '../scripts/seed-test-conversations';
//
// Cada conversa tem:
//   - id: chave única (`conv_<scenario>_<n>`)
//   - scenario: tag de categoria (saudacao, estoque_existe, objecao, etc.)
//   - description: 1 linha humanamente legível
//   - turns: alternância customer/agent (agent é OPCIONAL — quando não tem,
//     a expectativa é deixar o LLM gerar pra eval)
//   - expected: heurísticas pro comportamento esperado (entities, state, tools)
//   - tags: array de keywords pra filtragem (ex: ["bant","handoff","negativo"])
//
// DADOS ANONIMIZADOS — nenhuma conversa real de cliente foi usada como base.
// Modelos de veículo e preços são fictícios mas plausíveis pro mercado BR.
// =============================================================================

export type ConversationTurn = {
  /** Quem fala: cliente humano ou agente Pedro. */
  role: "customer" | "agent";
  /** Texto da mensagem (sem timestamp). */
  text: string;
  /** Entidades que o `extractEntitiesWithClaude` deveria detectar depois desse turno. */
  expected_extracted_entities?: Partial<{
    nome: string | null;
    telefone: string | null;
    interesse_veiculo: string | null;
    forma_pagamento: "a_vista" | "financiado" | "consorcio" | null;
    valor_entrada: string | null;
    troca_veiculo: string | null;
    cidade: string | null;
    eco_agente_detectado: boolean;
  }>;
  /** Flags do `pedro_conversation_state` que deveriam estar setadas após esse turno. */
  expected_state_flags?: Partial<{
    ja_apresentado: boolean;
    veiculo_apresentado_id: string | null;
    pode_visitar_loja: boolean | null;
    qualificacao_score: number;
  }>;
  /** Tools que o agente deveria chamar nesse turno (ordem importa). */
  expected_tool_calls?: Array<
    "consultarEstoqueBndv" | "transferirParaVendedor" | "agendarVisita"
  >;
  /** Notas humanas pra revisão (não consumido por código). */
  comment?: string;
};

export type SyntheticConversation = {
  id: string;
  scenario: string;
  description: string;
  tags: string[];
  turns: ConversationTurn[];
  expected_final_state: {
    qualified: boolean;
    transferred: boolean;
    notes?: string;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 20 conversas — agrupadas por arquétipo
// ─────────────────────────────────────────────────────────────────────────────

export const SYNTHETIC_CONVERSATIONS: SyntheticConversation[] = [
  // ── 1. Saudação simples ───────────────────────────────────────────────────
  {
    id: "conv_saudacao_01",
    scenario: "saudacao_simples",
    description: "Cliente manda só 'Oi' — agente deve se apresentar 1 vez.",
    tags: ["saudacao", "curto", "feliz"],
    turns: [
      { role: "customer", text: "Oi" },
      {
        role: "agent",
        text: "Oi! Sou o Pedro da LogosCar 😊 Tô aqui pra te ajudar a achar seu próximo carro. Tá olhando algum modelo específico?",
        expected_state_flags: { ja_apresentado: true },
      },
      { role: "customer", text: "Só olhando ainda" },
    ],
    expected_final_state: { qualified: false, transferred: false },
  },

  // ── 2. Pergunta de horário/endereço ───────────────────────────────────────
  {
    id: "conv_info_loja_02",
    scenario: "info_basica_loja",
    description: "Cliente pergunta horário e endereço.",
    tags: ["info", "curto"],
    turns: [
      { role: "customer", text: "Bom dia, qual o horário de vocês?" },
      { role: "customer", text: "E onde fica a loja?" },
      {
        role: "agent",
        text: "Bom dia! Funcionamos seg a sex 8h-18h, sáb 8h-12h. Estamos na Av. Brasil 1234, centro. Posso te ajudar com algum carro?",
      },
    ],
    expected_final_state: { qualified: false, transferred: false },
  },

  // ── 3. Estoque existe (caminho feliz) ─────────────────────────────────────
  {
    id: "conv_estoque_existe_03",
    scenario: "estoque_modelo_disponivel",
    description: "Cliente pede Onix 2022 — temos. Agente apresenta com foto.",
    tags: ["estoque", "feliz", "bndv"],
    turns: [
      { role: "customer", text: "Vocês tem Onix 2022?" },
      {
        role: "agent",
        text: "Deixa eu olhar pra você",
        expected_tool_calls: ["consultarEstoqueBndv"],
      },
      {
        role: "agent",
        text: "Temos sim! Onix LT 1.0 Turbo 2022, prata, 38.000 km, R$ 78.900. Quer ver foto?",
        expected_extracted_entities: { interesse_veiculo: "Onix" },
        expected_state_flags: { ja_apresentado: true },
      },
      { role: "customer", text: "Manda" },
    ],
    expected_final_state: { qualified: false, transferred: false },
  },

  // ── 4. Estoque NÃO existe → similares (caso de bug recorrente) ───────────
  {
    id: "conv_estoque_inexistente_04",
    scenario: "estoque_zero_oferecer_similar",
    description:
      "Cliente pede HRV 2024 — não temos. Agente deve OFERECER similares (Tracker, T-Cross, Kicks), não dizer 'não temos' seco.",
    tags: ["estoque", "negativo", "bndv", "similar", "ASSERT_05"],
    turns: [
      { role: "customer", text: "Tem HRV 2024?" },
      {
        role: "agent",
        text: "Vou checar pra você",
        expected_tool_calls: ["consultarEstoqueBndv"],
      },
      {
        role: "agent",
        text: "HRV 2024 a gente não tá com no momento, mas temos opções parecidas no mesmo segmento: Tracker Premier 2023 e T-Cross Highline 2023. Quer que eu te mostre uma delas?",
        comment:
          "REGRESSÃO: antes do IT-2.3, o agente respondia só 'não temos' e fechava a porta.",
      },
      { role: "customer", text: "Tracker me interessa" },
    ],
    expected_final_state: { qualified: false, transferred: false },
  },

  // ── 5. Cliente fora de escopo (flerte / assunto não-veicular) ────────────
  {
    id: "conv_fora_escopo_05",
    scenario: "fora_escopo_flerte",
    description: "Cliente puxa assunto pessoal. Agente desvia educadamente.",
    tags: ["fora_escopo", "guardrail", "ASSERT_GUARDRAIL"],
    turns: [
      { role: "customer", text: "Vc é mulher?" },
      {
        role: "agent",
        text: "Aqui é o Pedro 😅 Tô focado em te ajudar a achar um carro bom. Tá olhando algum modelo?",
      },
      { role: "customer", text: "kkk beleza, queria ver Civic" },
    ],
    expected_final_state: { qualified: false, transferred: false },
  },

  // ── 6. Negociação de preço ────────────────────────────────────────────────
  {
    id: "conv_negociacao_preco_06",
    scenario: "negociacao_preco",
    description: "Cliente já viu o carro e tenta abater valor.",
    tags: ["negociacao", "handoff_potencial"],
    turns: [
      {
        role: "customer",
        text: "Esse Civic Touring tá saindo 105 mil, fecha por 100?",
      },
      {
        role: "agent",
        text: "Entendo seu interesse! O preço de tabela tá ajustado, mas quem fecha condição assim é nosso vendedor presencial. Vou te passar pro pessoal aqui — pode ser?",
        expected_tool_calls: ["transferirParaVendedor"],
      },
    ],
    expected_final_state: {
      qualified: true,
      transferred: true,
      notes: "Cliente avançado, pedindo desconto — escalar pro vendedor humano.",
    },
  },

  // ── 7. Pagamento à vista ──────────────────────────────────────────────────
  {
    id: "conv_pagamento_vista_07",
    scenario: "pagamento_a_vista",
    description: "Cliente diz que paga à vista — qualificação avança rápido.",
    tags: ["pagamento", "qualificado"],
    turns: [
      { role: "customer", text: "Quero o Compass Sport 2023" },
      {
        role: "agent",
        text: "Beleza! Tô olhando aqui. Você tá pensando em à vista, financiado ou consórcio?",
      },
      { role: "customer", text: "À vista" },
      {
        role: "agent",
        text: "Show. Pra agilizar, qual seu nome e cidade?",
        expected_extracted_entities: { forma_pagamento: "a_vista" },
      },
      { role: "customer", text: "André, Taubaté" },
      {
        role: "agent",
        text: "Perfeito André. Vou te conectar com nosso vendedor pra confirmar o Compass e fechar tudo — pode ser?",
        expected_tool_calls: ["transferirParaVendedor"],
        expected_extracted_entities: { nome: "André", cidade: "Taubaté" },
      },
    ],
    expected_final_state: { qualified: true, transferred: true },
  },

  // ── 8. Pagamento financiado (entrada + parcelas) ──────────────────────────
  {
    id: "conv_pagamento_financiado_08",
    scenario: "pagamento_financiado_com_entrada",
    description: "Cliente quer financiar com entrada — agente coleta BANT completo.",
    tags: ["pagamento", "bant", "financiamento"],
    turns: [
      { role: "customer", text: "Quero ver opção pra Tracker financiada" },
      {
        role: "agent",
        text: "Boa! Você tem ideia de entrada e parcela que cabe pra você?",
      },
      { role: "customer", text: "Uns 30 mil de entrada e parcela até 1500" },
      {
        role: "agent",
        text: "Anotado. Quem analisa essa simulação é o vendedor — vou te transferir com seus dados pra ele te mandar a proposta exata.",
        expected_extracted_entities: {
          forma_pagamento: "financiado",
          valor_entrada: "30 mil",
        },
        expected_tool_calls: ["transferirParaVendedor"],
      },
    ],
    expected_final_state: { qualified: true, transferred: true },
  },

  // ── 9. Troca (usado) ──────────────────────────────────────────────────────
  {
    id: "conv_troca_usado_09",
    scenario: "troca_carro_usado",
    description: "Cliente quer trocar HB20 antigo por algo maior.",
    tags: ["troca", "qualificado_parcial"],
    turns: [
      { role: "customer", text: "Tenho um HB20 2018 pra dar de troca" },
      {
        role: "agent",
        text: "Bacana! Qual seria o carro novo que você tá de olho?",
      },
      { role: "customer", text: "Algo maior, tipo Creta" },
      {
        role: "agent",
        text: "Tenho Creta Comfort 2023 disponível. Pra avaliar seu HB20 e fazer a proposta de troca, o pessoal do balcão é mais ágil — quer que eu te conecte?",
        expected_extracted_entities: {
          troca_veiculo: "HB20 2018",
          interesse_veiculo: "Creta",
        },
        expected_tool_calls: ["transferirParaVendedor"],
      },
    ],
    expected_final_state: { qualified: true, transferred: true },
  },

  // ── 10. Visita agendada (caminho feliz) ───────────────────────────────────
  {
    id: "conv_visita_agendada_10",
    scenario: "visita_agendada_caminho_feliz",
    description: "Cliente quer ir até a loja amanhã 14h.",
    tags: ["visita", "agendamento"],
    turns: [
      { role: "customer", text: "Posso ir aí amanhã olhar o Onix?" },
      { role: "agent", text: "Claro! Que horas é melhor pra você?" },
      { role: "customer", text: "14h" },
      {
        role: "agent",
        text: "Show! Anotado pra amanhã 14h. Me passa seu nome pra deixar com nosso vendedor?",
        expected_state_flags: { pode_visitar_loja: true },
      },
      { role: "customer", text: "Carlos Mendes" },
      {
        role: "agent",
        text: "Combinado Carlos! Amanhã 14h te esperamos. Vou avisar o vendedor pra te receber 👍",
        expected_tool_calls: ["transferirParaVendedor"],
        expected_extracted_entities: { nome: "Carlos Mendes" },
      },
    ],
    expected_final_state: { qualified: true, transferred: true },
  },

  // ── 11. Cliente recusa visita ("moro longe") ──────────────────────────────
  {
    id: "conv_recusa_visita_11",
    scenario: "cliente_distante_recusa_visita",
    description: "Cliente fora da cidade — agente NÃO insiste em visita.",
    tags: ["objecao", "logistica", "ASSERT_NAO_INSISTE"],
    turns: [
      { role: "customer", text: "Tenho interesse no Polo Track" },
      {
        role: "agent",
        text: "Boa! Você consegue passar na loja pra fazer test drive?",
      },
      { role: "customer", text: "Moro em Manaus, é longe demais" },
      {
        role: "agent",
        text: "Entendi! Sem problema. A gente consegue te mandar tudo por foto/video e fechar à distância. Você prefere ver detalhes do Polo aqui mesmo?",
        expected_state_flags: { pode_visitar_loja: false },
        comment: "Agente NÃO deve continuar insistindo em visita presencial.",
      },
    ],
    expected_final_state: { qualified: false, transferred: false },
  },

  // ── 12. Qualificação completa → transferência ─────────────────────────────
  {
    id: "conv_qualificacao_completa_12",
    scenario: "qualificacao_full_handoff",
    description:
      "Cliente fornece todos os dados (nome, telefone, modelo, pagamento) — agente transfere.",
    tags: ["bant", "handoff", "feliz", "ASSERT_TRANSFER"],
    turns: [
      { role: "customer", text: "Boa tarde, sou a Roberta, queria um Strada CD" },
      {
        role: "agent",
        text: "Oi Roberta, boa tarde! Tô olhando aqui",
        expected_extracted_entities: { nome: "Roberta" },
        expected_tool_calls: ["consultarEstoqueBndv"],
      },
      {
        role: "agent",
        text: "Temos Strada Freedom CD 2023, flex manual, 53.700 km, R$ 98.500. Tá pensando à vista ou financiado?",
      },
      { role: "customer", text: "Financiado, posso dar 25 mil de entrada" },
      {
        role: "agent",
        text: "Anotado. Qual seu telefone pra eu deixar com o vendedor?",
        expected_extracted_entities: {
          forma_pagamento: "financiado",
          valor_entrada: "25 mil",
        },
      },
      { role: "customer", text: "11 98765-4321" },
      {
        role: "agent",
        text: "Perfeito Roberta. Vou te conectar com nosso vendedor agora pra fechar a proposta — ele já tá com seus dados.",
        expected_tool_calls: ["transferirParaVendedor"],
        expected_extracted_entities: { telefone: "11987654321" },
      },
    ],
    expected_final_state: { qualified: true, transferred: true },
  },

  // ── 13. Cliente volta depois de dias ──────────────────────────────────────
  {
    id: "conv_retorno_apos_dias_13",
    scenario: "cliente_retorno_lead_antigo",
    description:
      "Cliente reativa após 5 dias — agente deveria lembrar do veículo antes apresentado.",
    tags: ["memoria", "persistente", "IT-3.1"],
    turns: [
      { role: "customer", text: "Oi, pensei mais no Compass que vc mostrou" },
      {
        role: "agent",
        text: "Oi! Que bom que voltou. Era o Compass Sport 2023 prata, R$ 145.900, certo? Conseguiu decidir sobre a forma de pagamento?",
        comment:
          "EXPECTATIVA pós-IT-3.1: agente deve relembrar veiculo_apresentado do state persistido.",
      },
      { role: "customer", text: "Vou financiar, 40 de entrada" },
    ],
    expected_final_state: { qualified: false, transferred: false },
  },

  // ── 14. Pergunta múltipla compound ────────────────────────────────────────
  {
    id: "conv_pergunta_compound_14",
    scenario: "pergunta_compound_curta",
    description:
      "Cliente já viu o carro e pergunta 2 dados de uma vez. Agente deve responder curto E compound.",
    tags: ["verbosidade", "compound", "ASSERT_05_VERB"],
    turns: [
      {
        role: "agent",
        text: "Temos Tracker Premier 2023, 32 mil km, R$ 119.900",
        expected_state_flags: { ja_apresentado: true },
      },
      { role: "customer", text: "Qual a cor e tem teto solar?" },
      {
        role: "agent",
        text: "Branca, e sim, teto solar panorâmico ✨",
        comment:
          "REGRA IT-1.1+IT-1.3: cliente curto + compound = agente curto + compound (2 dados em 1 linha).",
      },
    ],
    expected_final_state: { qualified: false, transferred: false },
  },

  // ── 15. Foto adicional ────────────────────────────────────────────────────
  {
    id: "conv_foto_adicional_15",
    scenario: "pede_foto_adicional",
    description: "Cliente quer ver mais ângulos.",
    tags: ["foto", "media"],
    turns: [
      {
        role: "agent",
        text: "Strada Freedom CD 2023, ano único dona, R$ 98.500 [foto frente]",
        expected_state_flags: { ja_apresentado: true },
      },
      { role: "customer", text: "Manda foto da traseira e do interior?" },
      {
        role: "agent",
        text: "Pera ai, vou conseguir essas pra você",
        comment:
          "FUTURO IT-2.5: integrar com BNDV pra puxar outras imagens; hoje só responde texto.",
      },
    ],
    expected_final_state: { qualified: false, transferred: false },
  },

  // ── 16. Cliente cancela mid-conversa ──────────────────────────────────────
  {
    id: "conv_cancela_16",
    scenario: "cliente_desiste",
    description: "Cliente perde interesse no meio.",
    tags: ["negativo", "cancelamento"],
    turns: [
      { role: "customer", text: "Tô vendo o Civic" },
      {
        role: "agent",
        text: "Temos Civic Touring 2022, R$ 145.900. Como pretende pagar?",
      },
      { role: "customer", text: "Cara, deixa pra outra hora, valeu" },
      {
        role: "agent",
        text: "Beleza! Quando quiser, é só chamar. Boa semana 👋",
      },
    ],
    expected_final_state: { qualified: false, transferred: false },
  },

  // ── 17. Cliente impaciente ────────────────────────────────────────────────
  {
    id: "conv_impaciente_17",
    scenario: "cliente_impaciente",
    description: "Cliente quer resposta rápida, agente não pode ser verboso.",
    tags: ["verbosidade", "tom"],
    turns: [
      { role: "customer", text: "Civic 22 tem?" },
      { role: "agent", text: "Tem sim", expected_tool_calls: ["consultarEstoqueBndv"] },
      { role: "customer", text: "Preço?" },
      { role: "agent", text: "R$ 145.900", comment: "Resposta curta = ok" },
      { role: "customer", text: "Quero" },
      {
        role: "agent",
        text: "Beleza, qual seu nome pra eu passar pro vendedor?",
      },
    ],
    expected_final_state: { qualified: false, transferred: false },
  },

  // ── 18. Termos errados ────────────────────────────────────────────────────
  {
    id: "conv_termos_errados_18",
    scenario: "cliente_usa_sinonimo",
    description:
      "Cliente fala 'cabine dupla' (não 'CD'). Agente deve mapear via IT-2.3 sinônimos.",
    tags: ["bndv", "sinonimos", "PEDRO_BNDV_SYNONYMS_ENABLED"],
    turns: [
      { role: "customer", text: "Tem Strada cabine dupla manual?" },
      {
        role: "agent",
        text: "Vou consultar",
        expected_tool_calls: ["consultarEstoqueBndv"],
      },
      {
        role: "agent",
        text: "Temos Strada Freedom CD 2023, flex manual, R$ 98.500. Quer ver foto?",
        comment:
          "REGRESSÃO: antes do mapa de sinônimos, 'cabine dupla' não batia com 'CD' no versionName.",
      },
    ],
    expected_final_state: { qualified: false, transferred: false },
  },

  // ── 19. Cliente menciona concorrente ──────────────────────────────────────
  {
    id: "conv_concorrente_19",
    scenario: "cliente_compara_concorrente",
    description:
      "Cliente diz que viu mais barato em outra loja — agente não deve depreciar concorrente.",
    tags: ["objecao", "guardrail", "concorrencia"],
    turns: [
      {
        role: "customer",
        text: "Esse Onix vi por 75 mil na loja do Zé, vc cobre?",
      },
      {
        role: "agent",
        text: "Posso entender que tá pesquisando! Quem analisa cobertura de preço é nosso vendedor presencial. Quer que eu te conecte pra ele te passar nossa condição?",
        expected_tool_calls: ["transferirParaVendedor"],
        comment:
          "Agente NÃO deve dizer mal da concorrência nem prometer cobrir o preço sem confirmar.",
      },
    ],
    expected_final_state: { qualified: true, transferred: true },
  },

  // ── 20. Confirmação de compra ─────────────────────────────────────────────
  {
    id: "conv_confirma_compra_20",
    scenario: "cliente_decidido_compra",
    description: "Cliente já decidido — handoff direto e ágil.",
    tags: ["fechamento", "feliz", "handoff"],
    turns: [
      {
        role: "customer",
        text: "Decidi: quero o Tracker Premier 2023, R$ 119.900, financiado",
      },
      { role: "agent", text: "Excelente decisão! Qual seu nome e telefone?" },
      { role: "customer", text: "Marcio Silva, 47 99876-5432" },
      {
        role: "agent",
        text: "Anotei Marcio. Vou te conectar com nosso vendedor agora pra ele preparar o contrato e a entrega — ele já vai te chamar.",
        expected_tool_calls: ["transferirParaVendedor"],
        expected_extracted_entities: {
          nome: "Marcio Silva",
          telefone: "47998765432",
        },
      },
    ],
    expected_final_state: { qualified: true, transferred: true },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers úteis (não consomem nada nas fixtures — só conveniência pra eval)
// ─────────────────────────────────────────────────────────────────────────────

export function getConversationsByTag(tag: string): SyntheticConversation[] {
  return SYNTHETIC_CONVERSATIONS.filter((c) => c.tags.includes(tag));
}

export function getConversationById(id: string): SyntheticConversation | undefined {
  return SYNTHETIC_CONVERSATIONS.find((c) => c.id === id);
}

export function getAllTags(): string[] {
  const set = new Set<string>();
  SYNTHETIC_CONVERSATIONS.forEach((c) => c.tags.forEach((t) => set.add(t)));
  return Array.from(set).sort();
}

export function getTransferredCount(): number {
  return SYNTHETIC_CONVERSATIONS.filter((c) => c.expected_final_state.transferred)
    .length;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI: rodar `npx tsx scripts/seed-test-conversations.ts` imprime stats
// (NÃO escreve em banco — fixture pura).
// ─────────────────────────────────────────────────────────────────────────────

if (typeof require !== "undefined" && require.main === module) {
  // eslint-disable-next-line no-console
  console.log(`📚 ${SYNTHETIC_CONVERSATIONS.length} conversas sintéticas carregadas`);
  // eslint-disable-next-line no-console
  console.log(`🏷️  Tags únicas: ${getAllTags().join(", ")}`);
  // eslint-disable-next-line no-console
  console.log(`📤 Esperam transferência: ${getTransferredCount()}/${SYNTHETIC_CONVERSATIONS.length}`);
}
