// Sanity test do seed de 20 conversas sintéticas do Pedro SDR.
// Não valida comportamento do agente — valida apenas a INTEGRIDADE da fixture.

import { describe, it, expect } from "vitest";
import {
  SYNTHETIC_CONVERSATIONS,
  getAllTags,
  getConversationById,
  getConversationsByTag,
  getTransferredCount,
} from "../../scripts/seed-test-conversations";

describe("seed de conversas sinteticas (Pedro SDR)", () => {
  it("contem exatamente 20 conversas", () => {
    expect(SYNTHETIC_CONVERSATIONS).toHaveLength(20);
  });

  it("todos os IDs sao unicos", () => {
    const ids = SYNTHETIC_CONVERSATIONS.map((c) => c.id);
    expect(new Set(ids).size).toBe(20);
  });

  it("cada conversa tem >= 1 turno", () => {
    SYNTHETIC_CONVERSATIONS.forEach((c) => {
      expect(c.turns.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("cada turno tem role valido (customer | agent)", () => {
    SYNTHETIC_CONVERSATIONS.forEach((c) => {
      c.turns.forEach((t) => {
        expect(["customer", "agent"]).toContain(t.role);
      });
    });
  });

  it("toda conversa comeca com customer (cliente inicia o contato)", () => {
    SYNTHETIC_CONVERSATIONS.forEach((c) => {
      if (c.id === "conv_pergunta_compound_14" || c.id === "conv_foto_adicional_15") {
        // exceções intencionais: começam com agente apresentando carro
        return;
      }
      expect(c.turns[0].role, `conversa ${c.id} deve comecar com customer`).toBe(
        "customer"
      );
    });
  });

  it("toda conversa tem expected_final_state com 2 booleanos", () => {
    SYNTHETIC_CONVERSATIONS.forEach((c) => {
      expect(typeof c.expected_final_state.qualified).toBe("boolean");
      expect(typeof c.expected_final_state.transferred).toBe("boolean");
    });
  });

  it("toda conversa tem >= 1 tag", () => {
    SYNTHETIC_CONVERSATIONS.forEach((c) => {
      expect(c.tags.length).toBeGreaterThan(0);
    });
  });

  it("helper getConversationById funciona", () => {
    const c = getConversationById("conv_saudacao_01");
    expect(c).toBeDefined();
    expect(c!.scenario).toBe("saudacao_simples");
  });

  it("helper getConversationsByTag filtra corretamente", () => {
    const handoffs = getConversationsByTag("handoff");
    expect(handoffs.length).toBeGreaterThan(0);
    handoffs.forEach((c) => expect(c.tags).toContain("handoff"));
  });

  it("helper getAllTags retorna array ordenado unico", () => {
    const tags = getAllTags();
    expect(tags.length).toBeGreaterThan(5);
    expect(new Set(tags).size).toBe(tags.length);
    expect([...tags].sort()).toEqual(tags);
  });

  it("getTransferredCount conta corretamente", () => {
    const n = getTransferredCount();
    // Sabemos que 8 conversas terminam transferidas
    // (06 negociação, 07 vista, 08 financiado, 09 troca, 10 visita, 12 full, 19 concorrente, 20 fechamento)
    expect(n).toBe(8);
  });

  it("cobertura minima de cenarios criticos por tag", () => {
    const criticalTags = [
      "saudacao",
      "estoque",
      "negativo",
      "bant",
      "handoff",
      "memoria",
      "objecao",
      "verbosidade",
    ];
    criticalTags.forEach((tag) => {
      expect(
        getConversationsByTag(tag).length,
        `tag '${tag}' deveria ter >= 1 conversa`
      ).toBeGreaterThan(0);
    });
  });
});
