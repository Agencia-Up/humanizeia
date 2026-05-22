// =============================================================================
// PREVIEW DE FEATURES — visualiza efeito de cada flag sem deploy
// =============================================================================
//
// COMO RODAR:
//   npm run preview
//   ou: npx vitest run src/preview/previewFeatures.test.ts --reporter=verbose
//
// Cada "test" abaixo é na verdade um DEMONSTRADOR — usa console.log pra
// mostrar como o system prompt / output do agente fica em diferentes
// cenários e combinações de flags. Não asserta nada de valor (apenas
// truthy pra passar o test runner).
//
// Cenários sintéticos cobertos:
//   - cold:       lead novo, nada coletado
//   - warm:       sabe modelo
//   - hot:        sabe modelo + pagamento
//   - qualified:  BNA completo (modelo + pagamento + nome + telefone)
//   - retorno:    cliente conhecido voltando após dias (cross-conversa)
//   - objecao:    cliente levantou objeção (mora_longe)
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  deriveBantFromState,
  formatBantBlock,
} from "../../supabase/functions/_shared/qualification/bantSchema";
import {
  calcLeadScoreV2,
  formatLeadScoreBlock,
} from "../../supabase/functions/_shared/qualification/leadScoring";
import { buildPersonaFewShotsBlock } from "../../supabase/functions/_shared/prompt/personaFewShots";
import {
  getRelevantPlaybooks,
  formatObjectionPlaybooksBlock,
} from "../../supabase/functions/_shared/memory/objectionPlaybooks";
import {
  derivePersistentProfile,
  formatPersistentProfileBlock,
} from "../../supabase/functions/_shared/memory/persistentProfile";
import { splitMessageForHumanization } from "../../supabase/functions/_shared/humanization/messageSplit";
import { calculateTypingDelayMs } from "../../supabase/functions/_shared/humanization/typingSimulator";
import { applyGuardrails } from "../../supabase/functions/_shared/reliability/guardrails";
import { relaxBndvFilters } from "../../supabase/functions/_shared/qualification/bndvFallback";
import { newTraceId, slog } from "../../supabase/functions/_shared/observability/structuredLog";

// ─── Cenários sintéticos ────────────────────────────────────────────────────

const SCENARIOS = {
  cold: {},
  warm: {
    interesse: { modelo_desejado: "Onix" },
  },
  hot: {
    lead: { nome: "André" },
    interesse: { modelo_desejado: "Tracker", configuracao: "Premier" },
    negociacao: { forma_pagamento: "financiado", valor_entrada: "30 mil" },
  },
  qualified: {
    lead: { nome: "Roberta", nome_completo: "Roberta Silva", telefone: "11987654321", cidade: "Taubaté" },
    interesse: { modelo_desejado: "Strada", configuracao: "Freedom CD" },
    negociacao: { forma_pagamento: "financiado", valor_entrada: "25 mil", tem_troca: false },
    veiculo_apresentado: { ja_apresentado: true, modelo: "Strada Freedom CD", ano: 2023, preco: "98.500" },
  },
  objecao: {
    lead: { nome: "Maria" },
    interesse: { modelo_desejado: "HRV" },
    atendimento: {
      objecoes: ["nao_pode_visitar", "esposo_decide"],
      pode_visitar_loja: false,
    },
  },
} as const;

const RETURNING_LEADS = [
  { lead_name: "Roberta Silva", client_city: "Taubaté", vehicle_interest: "Strada", payment_method: "financiado", status: "transferido", last_interaction_at: "2026-05-10T12:00:00Z" },
  { lead_name: "Roberta Silva", vehicle_interest: "Onix", last_interaction_at: "2026-05-01T10:00:00Z" },
];
const RETURNING_STATES = [
  { state: { lead: { nome_completo: "Roberta Silva", acompanhante_decisao: "esposo" }, negociacao: { forma_pagamento: "financiado" }, veiculo_apresentado: { ja_apresentado: true, modelo: "Strada Freedom CD", ano: 2023, preco: "98.500" }, atendimento: { objecoes: ["esposo_decide"] } } },
];

// ─── Helpers de formatação ──────────────────────────────────────────────────

function divider(title: string) {
  const line = "=".repeat(78);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

function block(label: string, content: string) {
  console.log(`\n--- ${label} ---`);
  console.log(content || "(vazio — flag teria zero efeito visível neste cenário)");
}

// ─── Demonstrações ──────────────────────────────────────────────────────────

describe("preview: efeito visual de cada feature flag", () => {
  it("IT-1.1 MESSAGE_SPLITTING — split em até 3 partes", () => {
    divider("IT-1.1: PEDRO_FF_MESSAGE_SPLITTING");

    const longResponse =
      "Boa tarde! Temos sim o Civic Touring 2022 disponível, prata, com 38 mil km rodados e revisões em dia na concessionária. " +
      "O preço de tabela está em R$ 145.900 a vista, ou facilitamos no financiamento com entrada e parcelas. " +
      "Você está pensando em à vista, financiado, ou tem algum carro pra dar de troca?";

    console.log(`\nResposta original do LLM (${longResponse.length} chars):`);
    console.log(`"${longResponse}"`);

    const parts = splitMessageForHumanization(longResponse);
    console.log(`\nCom flag ON — dividido em ${parts.length} partes:`);
    parts.forEach((p, i) => console.log(`  [${i + 1}/${parts.length}] "${p}"`));
    expect(parts.length).toBeGreaterThan(0);
  });

  it("IT-1.2 TYPING_SIMULATION — delay proporcional ao tamanho", () => {
    divider("IT-1.2: PEDRO_FF_TYPING_SIMULATION");

    const samples = [
      "Sim",
      "É 2023 😊",
      "Tenho sim. À vista, financiar ou troca?",
      "Temos Civic Touring 2022 prata 38 mil km por R$ 145.900",
      "Boa tarde! Temos o Civic Touring 2022 disponível, prata, 38 mil km, revisões em dia. Preço R$ 145.900 a vista, financiamento facilitamos.",
    ];

    console.log("\nDelay calculado (com randomFn=0.5, baseline):");
    samples.forEach((s) => {
      const ms = calculateTypingDelayMs(s, { randomFn: () => 0.5 });
      console.log(`  ${ms.toString().padStart(4)}ms — ${s.length.toString().padStart(3)} chars — "${s.slice(0, 60)}${s.length > 60 ? "..." : ""}"`);
    });
    expect(samples.length).toBe(5);
  });

  it("IT-1.3 PERSONA_FEW_SHOTS — bloco apendado no system prompt", () => {
    divider("IT-1.3: PEDRO_FF_PERSONA_FEW_SHOTS");

    const block = buildPersonaFewShotsBlock();
    console.log(`\nBloco apendado ao FINAL do system prompt (${block.length} chars):`);
    console.log(block);
    expect(block.length).toBeGreaterThan(100);
  });

  it("IT-2.1 BANT_QUALIFICATION — cada cenário", () => {
    divider("IT-2.1: PEDRO_FF_BANT_QUALIFICATION");

    for (const [name, state] of Object.entries(SCENARIOS)) {
      const bant = deriveBantFromState(state);
      block(`Cenário '${name}'`, formatBantBlock(bant));
    }
    expect(true).toBe(true);
  });

  it("IT-2.2 LEAD_SCORING — score + tier + breakdown", () => {
    divider("IT-2.2: PEDRO_FF_LEAD_SCORING");

    for (const [name, state] of Object.entries(SCENARIOS)) {
      const r = calcLeadScoreV2(state);
      console.log(`\n--- Cenário '${name}' → score=${r.score}, tier=${r.tier} ---`);
      console.log(formatLeadScoreBlock(r));
    }
    expect(true).toBe(true);
  });

  it("IT-2.3 BNDV_SIMILAR_VEHICLES — tentativas de relaxação", () => {
    divider("IT-2.3: PEDRO_FF_BNDV_SIMILAR_VEHICLES");

    const originalFilters = {
      marca: "Fiat",
      modelo: "Strada",
      versao: "Freedom",
      cambio: "manual",
      combustivel: "flex",
      cor: "preto",
    };
    console.log("\nFiltros originais:");
    console.log(JSON.stringify(originalFilters, null, 2));

    const attempts = relaxBndvFilters(originalFilters);
    console.log(`\nSe primeira busca retornar 0 itens, faz ${attempts.length} tentativas progressivas:`);
    attempts.forEach((a) => {
      console.log(`\n  Nível ${a.level} — ${a.description}`);
      console.log(`  Filtros: ${JSON.stringify(a.filters)}`);
    });
    expect(attempts.length).toBeGreaterThan(0);
  });

  it("IT-2.4 HANDOFF_TOOL_V2 — efeito coberto em testes próprios", () => {
    divider("IT-2.4: PEDRO_FF_HANDOFF_TOOL_V2");
    console.log("\nIT-2.4 enriquece o briefing JSON enviado ao vendedor humano");
    console.log("com motivo + urgência + score + summary estruturado.");
    console.log("Veja testes em src/test/handoffBriefingV2.test.ts (18 testes).");
    console.log("Preview de briefing real requer state + tool args — não é puramente prompt.");
    expect(true).toBe(true);
  });

  it("IT-3.1 PERSISTENT_PROFILES — cross-conversa", () => {
    divider("IT-3.1: PEDRO_FF_PERSISTENT_PROFILES");

    const profile = derivePersistentProfile(RETURNING_LEADS, RETURNING_STATES);
    console.log("\nCenário: Roberta volta após 7 dias. Conversa anterior teve:");
    console.log("- 2 leads (1 transferido, 1 ativo)");
    console.log("- 1 state com BNA completo + acompanhante 'esposo'");
    console.log("\nPerfil derivado:");
    console.log(JSON.stringify(profile, null, 2));
    console.log("\nBloco apendado no system prompt:");
    console.log(formatPersistentProfileBlock(profile!));
    expect(profile).not.toBeNull();
  });

  it("IT-3.2 HIERARCHICAL_SUMMARIZATION — split de histórico", () => {
    divider("IT-3.2: PEDRO_FF_HIERARCHICAL_SUMMARIZATION");
    console.log("\nQuando histórico > 10 mensagens, busca 30 e separa:");
    console.log("  - 20 antigas → sumarizadas via Claude Haiku");
    console.log("  - 10 recentes → cruas (preserva contexto imediato)");
    console.log("\nNo system prompt, antes das 10 cruas, é inserido:");
    console.log(`  {
    role: 'system',
    content: '## RESUMO DAS 20 MENSAGENS ANTERIORES...'
  }`);
    console.log("\nFailsafe: se Claude falhar, fallback pras 10 últimas (igual atual).");
    console.log("Preview da chamada Claude requer ANTHROPIC_API_KEY + 1 chamada real.");
    expect(true).toBe(true);
  });

  it("IT-3.3 OBJECTION_PLAYBOOKS — playbook quando objeção detectada", () => {
    divider("IT-3.3: PEDRO_FF_OBJECTION_PLAYBOOKS");

    const objections = ["nao_pode_visitar", "esposo_decide"];
    console.log(`\nObjeções no state.atendimento.objecoes: ${JSON.stringify(objections)}`);

    const playbooks = getRelevantPlaybooks(objections);
    console.log(`\n${playbooks.length} playbook(s) matched → bloco apendado:`);
    console.log(formatObjectionPlaybooksBlock(playbooks));
    expect(playbooks.length).toBe(2);
  });

  it("IT-4.1 LLM_RETRY_FALLBACK — exemplo de cortesia", () => {
    divider("IT-4.1: PEDRO_FF_LLM_RETRY_FALLBACK");
    console.log(`
Quando todas as 3 tentativas da OpenAI falharem:

  ANTES (sem flag): HTTP 500 ao webhook origin. Conversa silenciosa.
  Cliente espera. Vendedor não sabe que algo deu errado.

  DEPOIS (flag on): envia ao cliente via /send/text:

    "Pera ai, tive uma instabilidade aqui. Pode me mandar de
     novo daqui uns 2 minutinhos? 🙏"

  + registra em wa_inbox + retorna HTTP 200.
  Conversa fica viva.
`);
    expect(true).toBe(true);
  });

  it("IT-4.2 GUARDRAILS — 4 categorias de bloqueio", () => {
    divider("IT-4.2: PEDRO_FF_GUARDRAILS");

    const samples = [
      { text: "O carro sai por R$ 78.900", state: {} },
      { text: "Sim, faço a entrega em casa de graça", state: { veiculo_apresentado: { ja_apresentado: true } } },
      { text: "Tem 53.700 km rodados", state: {} },
      { text: "Olha o Lula tá fazendo bagunça, mas o carro tá ok", state: { veiculo_apresentado: { ja_apresentado: true } } },
      { text: "Tudo bem? Qual modelo você procura?", state: {} },
    ];

    for (const { text, state } of samples) {
      const r = applyGuardrails(text, state);
      console.log(`\nResposta: "${text}"`);
      console.log(`  → blocked: ${r.blocked}`);
      if (r.blocked) {
        console.log(`  → violations: ${r.violations.map((v) => v.rule).join(", ")}`);
        console.log(`  → substitui por: "${r.safeFallback}"`);
      }
    }
    expect(true).toBe(true);
  });

  it("IT-4.3 STRUCTURED_LOGGING — exemplo de output JSON", () => {
    divider("IT-4.3: PEDRO_FF_STRUCTURED_LOGGING");

    const traceId = newTraceId();
    console.log(`\nTrace ID gerado: ${traceId}`);
    console.log("\nExemplo de eventos logados durante 1 turno (formato JSON 1-linha):");
    const captured: string[] = [];
    const fakeConsole = (s: string) => captured.push(s);

    slog("info", "turn_start", { trace_id: traceId, instance_name: "logoscar01", remote_jid: "5511987654321@s.whatsapp.net", text_length: 14 }, fakeConsole);
    slog("warn", "guardrail_block", { trace_id: traceId, rules: ["preco_sem_veiculo"], original_excerpt: "Sai por R$ 78 mil" }, fakeConsole);
    slog("info", "turn_end", { trace_id: traceId, latency_ms: 2347, parts_sent: 2, split_enabled: true }, fakeConsole);

    captured.forEach((line) => console.log(`  ${line}`));
    console.log("\nParser pode agregar por trace_id pra rastrear toda a conversa.");
    expect(captured.length).toBe(3);
  });
});
