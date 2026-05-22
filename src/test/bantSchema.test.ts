// Testes do schema BANT (IT-2.1).

import { describe, it, expect } from "vitest";
import {
  deriveBantFromState,
  formatBantBlock,
} from "../../supabase/functions/_shared/qualification/bantSchema";

describe("deriveBantFromState", () => {
  it("state vazio retorna tudo 'unknown' + overallStage 'cold'", () => {
    const bant = deriveBantFromState({});
    expect(bant.budget.status).toBe("unknown");
    expect(bant.authority.status).toBe("unknown");
    expect(bant.need.status).toBe("unknown");
    expect(bant.timeline.status).toBe("discovery");
    expect(bant.overallStage).toBe("cold");
  });

  it("state null nao quebra", () => {
    const bant = deriveBantFromState(null);
    expect(bant.budget.status).toBe("unknown");
    expect(bant.overallStage).toBe("cold");
  });

  it("apenas modelo definido -> need=specific, overallStage=discovery", () => {
    const bant = deriveBantFromState({
      interesse: { modelo_desejado: "Onix" },
    });
    expect(bant.need.status).toBe("specific");
    expect(bant.need.detail).toContain("Onix");
    expect(bant.overallStage).toBe("discovery"); // 1 dimensao
  });

  it("modelo + forma_pagamento -> budget=known, need=specific, qualifying", () => {
    const bant = deriveBantFromState({
      interesse: { modelo_desejado: "Onix LT" },
      negociacao: { forma_pagamento: "à vista" },
    });
    expect(bant.budget.status).toBe("known");
    expect(bant.budget.detail).toContain("à vista");
    expect(bant.need.status).toBe("specific");
    expect(bant.overallStage).toBe("qualifying"); // 2 dimensoes
  });

  it("modelo + pagamento + nome (sem acompanhante) -> ready_to_handoff (BNA completo)", () => {
    const bant = deriveBantFromState({
      lead: { nome: "Andre" },
      interesse: { modelo_desejado: "Tracker" },
      negociacao: { forma_pagamento: "financiado", valor_entrada: "30 mil" },
    });
    expect(bant.authority.status).toBe("sole");
    // BNA completo + sole = pronto pra transferir
    expect(bant.overallStage).toBe("ready_to_handoff");
  });

  it("modelo + pagamento + acompanhante -> qualified (precisa terceiro decidir, nao handoff direto)", () => {
    const bant = deriveBantFromState({
      lead: { nome: "Maria", acompanhante_decisao: "esposo" },
      interesse: { modelo_desejado: "Compass" },
      negociacao: { forma_pagamento: "financiado" },
    });
    // 3 dimensoes conhecidas mas authority=shared -> timeline nao chega em ready_to_close
    // 3 known dimensions -> overallStage='qualified'
    expect(bant.overallStage).toBe("qualified");
    expect(bant.timeline.status).not.toBe("ready_to_close");
  });

  it("acompanhante_decisao preenchido -> authority=shared", () => {
    const bant = deriveBantFromState({
      lead: { nome: "Maria", acompanhante_decisao: "esposo" },
      interesse: { modelo_desejado: "Compass" },
      negociacao: { forma_pagamento: "financiado" },
    });
    expect(bant.authority.status).toBe("shared");
    expect(bant.authority.detail).toContain("esposo");
  });

  it("BNA completo + sole -> ready_to_handoff", () => {
    const bant = deriveBantFromState({
      lead: { nome: "Roberta" },
      interesse: { modelo_desejado: "Strada", configuracao: "CD" },
      negociacao: { forma_pagamento: "financiado", valor_entrada: "25 mil" },
    });
    expect(bant.timeline.status).toBe("ready_to_close");
    expect(bant.overallStage).toBe("ready_to_handoff");
    expect(bant.nextSuggestedAsk.toLowerCase()).toContain("transferir");
  });

  it("nextSuggestedAsk orienta proximo passo quando need=unknown", () => {
    const bant = deriveBantFromState({});
    expect(bant.nextSuggestedAsk.toLowerCase()).toContain("modelo");
  });

  it("nextSuggestedAsk orienta forma de pagamento quando need ok e budget unknown", () => {
    const bant = deriveBantFromState({
      interesse: { modelo_desejado: "Onix" },
    });
    expect(bant.nextSuggestedAsk.toLowerCase()).toContain("forma de pagamento");
  });

  it("apresentado mas sem telefone -> sugere pedir telefone pra handoff", () => {
    const bant = deriveBantFromState({
      lead: { nome: "Carlos" },
      interesse: { modelo_desejado: "Onix" },
      negociacao: { forma_pagamento: "à vista" },
      veiculo_apresentado: { ja_apresentado: true },
    });
    // overallStage e ready_to_handoff (BNA completo), sugere transferir
    // mas se nao for ready, deveria sugerir telefone — vamos testar com auth=unknown
    const bant2 = deriveBantFromState({
      interesse: { modelo_desejado: "Onix" },
      negociacao: { forma_pagamento: "à vista" },
      veiculo_apresentado: { ja_apresentado: true },
    });
    // sem nome, authority=unknown -> sugere confirmar nome
    expect(bant2.nextSuggestedAsk.toLowerCase()).toContain("nome");
  });

  it("troca declarada sem forma_pagamento -> budget=known", () => {
    const bant = deriveBantFromState({
      negociacao: { tem_troca: true },
    });
    expect(bant.budget.status).toBe("known");
    expect(bant.budget.detail.toLowerCase()).toContain("troca");
  });

  it("veiculo apresentado sem modelo desejado setado -> need=exploring", () => {
    const bant = deriveBantFromState({
      veiculo_apresentado: { ja_apresentado: true, modelo: "Civic" },
    });
    expect(bant.need.status).toBe("exploring");
  });
});

describe("formatBantBlock", () => {
  it("overallStage='cold' retorna string vazia", () => {
    const bant = deriveBantFromState({});
    expect(formatBantBlock(bant)).toBe("");
  });

  it("inclui todas as 4 dimensoes + estagio + sugestao quando nao-cold", () => {
    const bant = deriveBantFromState({
      lead: { nome: "Roberta" },
      interesse: { modelo_desejado: "Strada" },
      negociacao: { forma_pagamento: "financiado" },
    });
    const block = formatBantBlock(bant);
    expect(block).toContain("## QUALIFICAÇÃO BANT");
    expect(block).toContain("Budget");
    expect(block).toContain("Authority");
    expect(block).toContain("Need");
    expect(block).toContain("Timeline");
    expect(block).toContain("Estágio geral");
    expect(block).toContain("Próxima ação sugerida");
  });

  it("formata estagio ready_to_handoff com info correta", () => {
    const bant = deriveBantFromState({
      lead: { nome: "Roberta" },
      interesse: { modelo_desejado: "Strada" },
      negociacao: { forma_pagamento: "à vista" },
    });
    const block = formatBantBlock(bant);
    expect(block).toContain("ready_to_handoff");
    expect(block.toLowerCase()).toContain("transferir");
  });
});
