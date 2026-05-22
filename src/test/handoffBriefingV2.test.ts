// Testes do briefing handoff V2 (IT-2.4).

import { describe, it, expect } from "vitest";
import { buildEnrichedBriefing } from "../../supabase/functions/_shared/handoff/handoffBriefingV2";

function baseInput(overrides: any = {}) {
  return {
    state: {
      lead: { nome: "Roberta", telefone: "11987654321" },
      interesse: { modelo_desejado: "Strada" },
      negociacao: { forma_pagamento: "financiado" },
    },
    leadName: "Roberta",
    leadPhone: "11987654321",
    agentName: "Pedro SDR",
    transferArgs: { motivo: "Cliente decidiu fechar" },
    ...overrides,
  };
}

describe("buildEnrichedBriefing", () => {
  it("retorna string nao-vazia com header e dados basicos", () => {
    const b = buildEnrichedBriefing(baseInput());
    expect(b.length).toBeGreaterThan(50);
    expect(b).toContain("Roberta");
    expect(b).toContain("11987654321");
    expect(b).toContain("Strada");
    expect(b).toContain("financiado");
  });

  it("default urgencia 'media' mostra emoji 🟡", () => {
    const b = buildEnrichedBriefing(baseInput());
    expect(b).toContain("🟡");
    expect(b).toContain("urgência: media");
  });

  it("urgencia imediata usa emoji 🔴", () => {
    const b = buildEnrichedBriefing(
      baseInput({ transferArgs: { motivo: "x", urgencia: "imediata" } })
    );
    expect(b).toContain("🔴");
    expect(b).toContain("urgência: imediata");
  });

  it("urgencia baixa usa emoji 🟢", () => {
    const b = buildEnrichedBriefing(
      baseInput({ transferArgs: { motivo: "x", urgencia: "baixa" } })
    );
    expect(b).toContain("🟢");
  });

  it("motivo_categoria 'lead_qualificado' mostra label legivel", () => {
    const b = buildEnrichedBriefing(
      baseInput({
        transferArgs: {
          motivo: "BNA completo",
          motivo_categoria: "lead_qualificado",
        },
      })
    );
    expect(b).toContain("Lead qualificado (BNA completo)");
  });

  it("motivo_categoria desconhecido (string crua) cai no fallback", () => {
    const b = buildEnrichedBriefing(
      baseInput({
        transferArgs: {
          motivo: "x",
          motivo_categoria: "custom_unknown" as any,
        },
      })
    );
    expect(b).toContain("custom_unknown");
  });

  it("inclui score + tier quando scoreInfo passado", () => {
    const b = buildEnrichedBriefing(
      baseInput({ scoreInfo: { score: 85, tier: "qualified" } })
    );
    expect(b).toContain("Score: 85/100");
    expect(b).toContain("qualified");
  });

  it("nao inclui score quando scoreInfo ausente", () => {
    const b = buildEnrichedBriefing(baseInput());
    expect(b).not.toContain("Score:");
  });

  it("inclui proxima acao sugerida quando passada", () => {
    const b = buildEnrichedBriefing(
      baseInput({
        transferArgs: {
          motivo: "x",
          proxima_acao_sugerida: "Ligar em 30 min com proposta de R$ 95.000",
        },
      })
    );
    expect(b).toContain("Próxima ação sugerida");
    expect(b).toContain("Ligar em 30 min");
  });

  it("usa bantNextSuggestedAsk como fallback quando proxima_acao_sugerida ausente", () => {
    const b = buildEnrichedBriefing(
      baseInput({
        transferArgs: { motivo: "x" },
        bantNextSuggestedAsk: "Confirmar disponibilidade de visita",
      })
    );
    expect(b).toContain("Próxima ação sugerida");
    expect(b).toContain("Confirmar disponibilidade de visita");
  });

  it("inclui veiculo_apresentado quando ja_apresentado=true", () => {
    const b = buildEnrichedBriefing(
      baseInput({
        state: {
          lead: { nome: "X", telefone: "1" },
          interesse: { modelo_desejado: "Onix" },
          negociacao: { forma_pagamento: "à vista" },
          veiculo_apresentado: {
            ja_apresentado: true,
            modelo: "Onix LT",
            ano: 2022,
            preco: "78.900",
          },
        },
      })
    );
    expect(b).toContain("Veículo apresentado");
    expect(b).toContain("Onix LT");
    expect(b).toContain("2022");
    expect(b).toContain("78.900");
  });

  it("inclui visita REMOTA quando pode_visitar_loja=false", () => {
    const b = buildEnrichedBriefing(
      baseInput({
        state: {
          lead: { nome: "X", telefone: "1" },
          interesse: { modelo_desejado: "X" },
          negociacao: { forma_pagamento: "x" },
          atendimento: { pode_visitar_loja: false },
        },
      })
    );
    expect(b).toContain("REMOTO");
  });

  it("inclui objecoes quando state.atendimento.objecoes nao-vazio", () => {
    const b = buildEnrichedBriefing(
      baseInput({
        state: {
          lead: { nome: "X", telefone: "1" },
          interesse: { modelo_desejado: "X" },
          negociacao: { forma_pagamento: "x" },
          atendimento: { objecoes: ["mora_longe", "esposa_decide"] },
        },
      })
    );
    expect(b).toContain("Objeções");
    expect(b).toContain("mora_longe");
    expect(b).toContain("esposa_decide");
  });

  it("inclui acompanhante de decisao quando preenchido", () => {
    const b = buildEnrichedBriefing(
      baseInput({
        state: {
          lead: {
            nome: "Maria",
            telefone: "1",
            acompanhante_decisao: "esposo",
          },
          interesse: { modelo_desejado: "X" },
          negociacao: { forma_pagamento: "x" },
        },
      })
    );
    expect(b).toContain("Decisão envolve");
    expect(b).toContain("esposo");
  });

  it("inclui link wa.me com numero limpo (so digitos)", () => {
    const b = buildEnrichedBriefing(
      baseInput({ state: { lead: { nome: "X", telefone: "(11) 98765-4321" } } })
    );
    expect(b).toContain("wa.me/11987654321");
  });

  it("inclui troca quando tem_troca=true e carro_troca preenchido", () => {
    const b = buildEnrichedBriefing(
      baseInput({
        state: {
          lead: { nome: "X", telefone: "1" },
          interesse: { modelo_desejado: "Y" },
          negociacao: {
            forma_pagamento: "financiado",
            tem_troca: true,
            carro_troca: { modelo: "HB20", ano: 2018, cambio: "manual" },
          },
        },
      })
    );
    expect(b).toContain("Troca");
    expect(b).toContain("HB20");
  });

  it("sempre termina com label V2", () => {
    const b = buildEnrichedBriefing(baseInput());
    expect(b).toContain("Briefing V2 gerado pelo Pedro SDR");
  });

  it("usa leadName fallback quando state.lead.nome ausente", () => {
    const b = buildEnrichedBriefing(
      baseInput({ state: {} })
    );
    expect(b).toContain("Roberta");
  });
});
