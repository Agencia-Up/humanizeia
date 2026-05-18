// Testes do bloco persona + few-shots (IT-1.3).

import { describe, it, expect } from "vitest";
import {
  PEDRO_PERSONA,
  PEDRO_FEW_SHOTS,
  buildPersonaFewShotsBlock,
} from "../../supabase/functions/_shared/prompt/personaFewShots";

describe("PEDRO_PERSONA", () => {
  it("contem regras criticas declaradas", () => {
    expect(PEDRO_PERSONA).toContain("Pedro");
    expect(PEDRO_PERSONA).toContain("WhatsApp");
    expect(PEDRO_PERSONA).toContain("revenda de carros");
    // tom
    expect(PEDRO_PERSONA.toLowerCase()).toContain("humano");
    expect(PEDRO_PERSONA.toLowerCase()).toContain("espelha");
    // honestidade
    expect(PEDRO_PERSONA.toLowerCase()).toContain("invent");
    expect(PEDRO_PERSONA.toLowerCase()).toContain("similares");
    // handoff
    expect(PEDRO_PERSONA).toContain("transferir_para_vendedor");
  });

  it("nao usa pontuacao corrompida (apostrofes / aspas tipograficas)", () => {
    // garante que o texto cole corretamente em system prompt
    expect(PEDRO_PERSONA).not.toMatch(/[“”‘’]/);
  });
});

describe("PEDRO_FEW_SHOTS", () => {
  it("tem exatamente 5 exemplos", () => {
    expect(PEDRO_FEW_SHOTS).toHaveLength(5);
  });

  it("cada exemplo tem label, customer e agent nao-vazios", () => {
    PEDRO_FEW_SHOTS.forEach((fs) => {
      expect(fs.label.length).toBeGreaterThan(0);
      expect(fs.customer.length).toBeGreaterThan(0);
      expect(fs.agent.length).toBeGreaterThan(0);
    });
  });

  it("cobre os 5 cenarios criticos (saudacao, qualificacao, objecao, fechamento, despedida)", () => {
    const labels = PEDRO_FEW_SHOTS.map((fs) => fs.label.toLowerCase()).join(" | ");
    expect(labels).toContain("saudação");
    expect(labels).toContain("qualificação");
    expect(labels).toContain("objeção");
    expect(labels).toContain("fechamento");
    expect(labels).toContain("despedida");
  });

  it("exemplo de fechamento menciona handoff/transferir", () => {
    const fechamento = PEDRO_FEW_SHOTS.find((fs) =>
      fs.label.toLowerCase().includes("fechamento")
    );
    expect(fechamento).toBeDefined();
    expect(fechamento!.agent.toLowerCase()).toMatch(/vendedor|conectar|transfer/);
  });

  it("respostas do agente sao curtas (≤ 200 chars) — humanizacao", () => {
    PEDRO_FEW_SHOTS.forEach((fs) => {
      expect(fs.agent.length).toBeLessThanOrEqual(200);
    });
  });
});

describe("buildPersonaFewShotsBlock", () => {
  it("retorna string nao-vazia", () => {
    const block = buildPersonaFewShotsBlock();
    expect(block.length).toBeGreaterThan(100);
  });

  it("contem o cabecalho de persona", () => {
    const block = buildPersonaFewShotsBlock();
    expect(block).toContain("## PERSONA E TOM");
  });

  it("contem o cabecalho de few-shots", () => {
    const block = buildPersonaFewShotsBlock();
    expect(block).toContain("## EXEMPLOS DE RESPOSTA");
  });

  it("contem o lembrete final (recency bias)", () => {
    const block = buildPersonaFewShotsBlock();
    expect(block).toContain("## LEMBRETE FINAL");
    expect(block).toContain("Espelhe");
  });

  it("inclui todos os 5 exemplos formatados", () => {
    const block = buildPersonaFewShotsBlock();
    PEDRO_FEW_SHOTS.forEach((fs) => {
      expect(block).toContain(fs.customer);
      expect(block).toContain(fs.agent);
    });
  });

  it("usa formato 'Cliente: ... / Voce: ...' pra cada exemplo", () => {
    const block = buildPersonaFewShotsBlock();
    expect(block).toContain('Cliente: "');
    expect(block).toContain('Você: "');
  });

  it("ordem dos few-shots e preservada", () => {
    const block = buildPersonaFewShotsBlock();
    const idxSaudacao = block.indexOf(PEDRO_FEW_SHOTS[0].customer);
    const idxQualif = block.indexOf(PEDRO_FEW_SHOTS[1].customer);
    const idxObjecao = block.indexOf(PEDRO_FEW_SHOTS[2].customer);
    expect(idxSaudacao).toBeLessThan(idxQualif);
    expect(idxQualif).toBeLessThan(idxObjecao);
  });
});
