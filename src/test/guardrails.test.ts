// Testes dos guardrails de saida (IT-4.2).

import { describe, it, expect } from "vitest";
import {
  applyGuardrails,
  SAFE_FALLBACK,
} from "../../supabase/functions/_shared/reliability/guardrails";

describe("SAFE_FALLBACK", () => {
  it("nao e vazio + curto", () => {
    expect(SAFE_FALLBACK.length).toBeGreaterThan(20);
    expect(SAFE_FALLBACK.length).toBeLessThanOrEqual(200);
  });
});

describe("applyGuardrails — texto vazio/null", () => {
  it("retorna blocked=false pra string vazia", () => {
    const r = applyGuardrails("", {});
    expect(r.blocked).toBe(false);
    expect(r.violations).toEqual([]);
  });

  it("retorna blocked=false pra null", () => {
    const r = applyGuardrails(null as any, {});
    expect(r.blocked).toBe(false);
  });

  it("retorna blocked=false pra texto inocente", () => {
    const r = applyGuardrails(
      "Oi, tudo bem? Qual modelo você tá olhando?",
      {}
    );
    expect(r.blocked).toBe(false);
  });
});

describe("applyGuardrails — preço sem veículo apresentado", () => {
  it("bloqueia 'R$ 78.900' quando ja_apresentado=false", () => {
    const r = applyGuardrails("O carro sai por R$ 78.900", {});
    expect(r.blocked).toBe(true);
    expect(r.violations[0].rule).toBe("preco_sem_veiculo");
    expect(r.violations[0].matched_text.toLowerCase()).toContain("r$");
  });

  it("bloqueia '40 mil' sem veículo", () => {
    const r = applyGuardrails("Esse modelo sai por uns 40 mil", {});
    expect(r.blocked).toBe(true);
    expect(r.violations[0].rule).toBe("preco_sem_veiculo");
  });

  it("NAO bloqueia preço quando ja_apresentado=true", () => {
    const r = applyGuardrails(
      "Ele tá R$ 78.900 mesmo",
      { veiculo_apresentado: { ja_apresentado: true } }
    );
    expect(r.blocked).toBe(false);
  });

  it("opt skipPriceCheck=true pula a regra", () => {
    const r = applyGuardrails("R$ 50 mil", {}, { skipPriceCheck: true });
    const priceViol = r.violations.find((v) => v.rule === "preco_sem_veiculo");
    expect(priceViol).toBeUndefined();
  });
});

describe("applyGuardrails — promessa de entrega/frete/garantia", () => {
  it("bloqueia 'faço a entrega'", () => {
    const r = applyGuardrails(
      "Sim, faço a entrega em casa",
      { veiculo_apresentado: { ja_apresentado: true } }
    );
    expect(r.blocked).toBe(true);
    expect(r.violations[0].rule).toBe("promessa_indevida");
  });

  it("bloqueia 'frete grátis'", () => {
    const r = applyGuardrails(
      "O frete é grátis pra sua cidade",
      { veiculo_apresentado: { ja_apresentado: true } }
    );
    expect(r.blocked).toBe(true);
    expect(r.violations[0].rule).toBe("promessa_indevida");
  });

  it("bloqueia 'garantia de 2 anos'", () => {
    const r = applyGuardrails(
      "Vem com garantia de 2 anos de fábrica",
      { veiculo_apresentado: { ja_apresentado: true } }
    );
    expect(r.blocked).toBe(true);
    expect(r.violations[0].rule).toBe("promessa_indevida");
  });

  it("opt skipDeliveryCheck=true pula a regra", () => {
    const r = applyGuardrails(
      "Faço a entrega",
      { veiculo_apresentado: { ja_apresentado: true } },
      { skipDeliveryCheck: true }
    );
    const delivViol = r.violations.find((v) => v.rule === "promessa_indevida");
    expect(delivViol).toBeUndefined();
  });
});

describe("applyGuardrails — invenção de specs", () => {
  it("bloqueia KM específico sem veículo", () => {
    const r = applyGuardrails("Tem 53.700 km rodados", {});
    expect(r.blocked).toBe(true);
    const v = r.violations.find((vi) => vi.rule === "km_inventado");
    expect(v).toBeDefined();
  });

  it("NAO bloqueia KM quando ja_apresentado=true", () => {
    const r = applyGuardrails(
      "Sim, 53.700 km",
      { veiculo_apresentado: { ja_apresentado: true } }
    );
    expect(r.blocked).toBe(false);
  });

  it("NAO bloqueia ano se texto tem '?' (pergunta do agente)", () => {
    const r = applyGuardrails("Você quer 2023 ou 2024?", {});
    const v = r.violations.find((vi) => vi.rule === "ano_inventado");
    expect(v).toBeUndefined();
  });

  it("bloqueia ano específico afirmativo sem veículo + texto longo", () => {
    const r = applyGuardrails(
      "Esse Civic é 2023 e tem único dono direto da concessionária autorizada",
      {}
    );
    const v = r.violations.find((vi) => vi.rule === "ano_inventado");
    expect(v).toBeDefined();
  });
});

describe("applyGuardrails — fora de escopo", () => {
  it("bloqueia menção política", () => {
    const r = applyGuardrails(
      "O Lula tá fazendo bagunça mas o carro tá ok",
      { veiculo_apresentado: { ja_apresentado: true } }
    );
    expect(r.blocked).toBe(true);
    expect(r.violations[0].rule).toBe("politica");
  });

  it("bloqueia depreciação de concorrente", () => {
    const r = applyGuardrails(
      "Eles são ruins, a outra loja é pior mesmo",
      { veiculo_apresentado: { ja_apresentado: true } }
    );
    expect(r.blocked).toBe(true);
    expect(r.violations[0].rule).toBe("depreciacao_concorrente");
  });

  it("bloqueia menção religiosa explícita", () => {
    const r = applyGuardrails(
      "Deus te abençoe sempre!",
      { veiculo_apresentado: { ja_apresentado: true } }
    );
    expect(r.blocked).toBe(true);
    expect(r.violations[0].rule).toBe("religiao");
  });
});

describe("applyGuardrails — multiple violations", () => {
  it("retorna todas as violacoes quando ha multiplas", () => {
    const r = applyGuardrails(
      "R$ 50 mil, faço a entrega e tem garantia de 3 anos",
      {}
    );
    expect(r.blocked).toBe(true);
    expect(r.violations.length).toBeGreaterThanOrEqual(2);
  });

  it("safeFallback sempre presente", () => {
    const r = applyGuardrails("ok", {});
    expect(r.safeFallback).toBe(SAFE_FALLBACK);
  });
});
