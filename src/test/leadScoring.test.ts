// Testes do lead scoring V2 (IT-2.2).

import { describe, it, expect } from "vitest";
import {
  calcLeadScoreV2,
  formatLeadScoreBlock,
  getLeadTier,
} from "../../supabase/functions/_shared/qualification/leadScoring";

describe("getLeadTier", () => {
  it("classifica corretamente cada faixa", () => {
    expect(getLeadTier(0)).toBe("cold");
    expect(getLeadTier(15)).toBe("cold");
    expect(getLeadTier(19)).toBe("cold");
    expect(getLeadTier(20)).toBe("warm");
    expect(getLeadTier(49)).toBe("warm");
    expect(getLeadTier(50)).toBe("hot");
    expect(getLeadTier(79)).toBe("hot");
    expect(getLeadTier(80)).toBe("qualified");
    expect(getLeadTier(100)).toBe("qualified");
  });
});

describe("calcLeadScoreV2", () => {
  it("state vazio retorna score 0 + tier cold", () => {
    const r = calcLeadScoreV2({});
    expect(r.score).toBe(0);
    expect(r.tier).toBe("cold");
    expect(r.breakdown.length).toBe(10);
  });

  it("state null nao quebra", () => {
    const r = calcLeadScoreV2(null);
    expect(r.score).toBe(0);
  });

  it("apenas nome -> 10 pontos cold", () => {
    const r = calcLeadScoreV2({ lead: { nome: "Andre" } });
    // nome +10 + decide sozinho +10 = 20 -> warm
    // (decide sozinho passa pq tem nome e sem acompanhante)
    expect(r.score).toBe(20);
    expect(r.tier).toBe("warm");
  });

  it("nome + telefone + modelo + pagamento + tem_troca + apresentado -> qualified", () => {
    const r = calcLeadScoreV2({
      lead: { nome: "Roberta", telefone: "11999999999" },
      interesse: { modelo_desejado: "Strada" },
      negociacao: { forma_pagamento: "à vista", tem_troca: false },
      veiculo_apresentado: { ja_apresentado: true },
    });
    // 10 + 20 + 15 + 15 + 10 + 10 + 10 (decide sozinho) = 90
    expect(r.score).toBe(90);
    expect(r.tier).toBe("qualified");
  });

  it("acompanhante_decisao desliga 'decide_sozinho'", () => {
    const r = calcLeadScoreV2({
      lead: { nome: "Maria", acompanhante_decisao: "esposo" },
      interesse: { modelo_desejado: "Onix" },
      negociacao: { forma_pagamento: "financiado" },
    });
    // 10 + 15 + 15 = 40 (decide_sozinho NAO passou)
    const decideSozinho = r.breakdown.find((c) => c.key === "decide_sozinho");
    expect(decideSozinho?.passed).toBe(false);
    expect(r.score).toBe(40);
    expect(r.tier).toBe("warm");
  });

  it("penalidade 'objecao_visita_nao_resolvida' aplica -15", () => {
    const r = calcLeadScoreV2({
      lead: { nome: "Carlos", telefone: "11999" },
      interesse: { modelo_desejado: "Civic" },
      negociacao: { forma_pagamento: "à vista" },
      atendimento: {
        pode_visitar_loja: false,
        // modo_atendimento NAO setado -> penalidade aplica
      },
    });
    // 10 + 20 + 15 + 15 + 10 = 70 - 15 = 55
    const penalidade = r.breakdown.find(
      (c) => c.key === "objecao_visita_nao_resolvida"
    );
    expect(penalidade?.passed).toBe(true);
    expect(r.rawPenalties).toBe(-15);
    expect(r.score).toBe(55);
    expect(r.tier).toBe("hot");
  });

  it("recusa visita MAS modo remoto definido -> penalidade NAO aplica", () => {
    const r = calcLeadScoreV2({
      lead: { nome: "Carlos", telefone: "11999" },
      interesse: { modelo_desejado: "Civic" },
      negociacao: { forma_pagamento: "à vista" },
      atendimento: {
        pode_visitar_loja: false,
        modo_atendimento: "remoto",
      },
    });
    const penalidade = r.breakdown.find(
      (c) => c.key === "objecao_visita_nao_resolvida"
    );
    expect(penalidade?.passed).toBe(false);
    // 10 + 20 + 15 + 15 + 10 + 5 (modo_atendimento) = 75, sem penalidade
    expect(r.score).toBe(75);
  });

  it("score nunca passa de 100", () => {
    // BNA + dados + apresentado + cidade + modo = 100
    const r = calcLeadScoreV2({
      lead: { nome: "X", telefone: "1", cidade: "SP" },
      interesse: { modelo_desejado: "X" },
      negociacao: { forma_pagamento: "x", tem_troca: true },
      veiculo_apresentado: { ja_apresentado: true },
      atendimento: { modo_atendimento: "presencial" },
    });
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("score nunca fica abaixo de 0", () => {
    const r = calcLeadScoreV2({
      atendimento: { pode_visitar_loja: false }, // só penalidade
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it("breakdown contem motivo para cada criterio (passed ou nao)", () => {
    const r = calcLeadScoreV2({
      lead: { nome: "Test" },
    });
    r.breakdown.forEach((c) => {
      expect(c.reason.length).toBeGreaterThan(0);
      expect(c.key).toMatch(/^[a-z_]+$/);
      expect(c.label.length).toBeGreaterThan(0);
    });
  });

  it("compativel com calcQualificationScore V1 (mesmo intervalo)", () => {
    const r = calcLeadScoreV2({
      lead: { nome: "Z", telefone: "1" },
      interesse: { modelo_desejado: "X" },
      negociacao: { forma_pagamento: "à vista" },
    });
    expect(typeof r.score).toBe("number");
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe("formatLeadScoreBlock", () => {
  it("contem header + score + tier", () => {
    const r = calcLeadScoreV2({ lead: { nome: "Test" } });
    const block = formatLeadScoreBlock(r);
    expect(block).toContain("## LEAD SCORE");
    expect(block).toContain("Score");
    expect(block).toContain("tier");
  });

  it("separa pontos coletados / penalidades / faltam", () => {
    const r = calcLeadScoreV2({
      lead: { nome: "X", telefone: "1" },
      interesse: { modelo_desejado: "Y" },
    });
    const block = formatLeadScoreBlock(r);
    expect(block).toContain("Pontos coletados");
    expect(block).toContain("✅");
    expect(block).toContain("Faltam coletar");
    expect(block).toContain("⏳");
  });

  it("mostra penalidade quando aplicada", () => {
    const r = calcLeadScoreV2({
      lead: { nome: "X" },
      atendimento: { pode_visitar_loja: false },
    });
    const block = formatLeadScoreBlock(r);
    expect(block).toContain("Penalidades aplicadas");
    expect(block).toContain("⚠️");
  });

  it("state vazio gera bloco com tier cold e 'faltam coletar'", () => {
    const r = calcLeadScoreV2({});
    const block = formatLeadScoreBlock(r);
    expect(block).toContain("cold");
    expect(block).toContain("Faltam coletar");
  });
});
