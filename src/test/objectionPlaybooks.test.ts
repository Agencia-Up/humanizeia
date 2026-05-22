// Testes dos playbooks de objecao (IT-3.3).

import { describe, it, expect } from "vitest";
import {
  OBJECTION_PLAYBOOKS,
  getRelevantPlaybooks,
  formatObjectionPlaybooksBlock,
} from "../../supabase/functions/_shared/memory/objectionPlaybooks";

describe("OBJECTION_PLAYBOOKS", () => {
  it("contem >= 5 objecoes (cobertura minima dos casos comuns)", () => {
    expect(OBJECTION_PLAYBOOKS.length).toBeGreaterThanOrEqual(5);
  });

  it("cada playbook tem os 6 campos obrigatorios nao-vazios", () => {
    OBJECTION_PLAYBOOKS.forEach((pb) => {
      expect(pb.key.length).toBeGreaterThan(0);
      expect(pb.label.length).toBeGreaterThan(0);
      expect(Array.isArray(pb.customer_signals)).toBe(true);
      expect(pb.customer_signals.length).toBeGreaterThan(0);
      expect(pb.agent_should.length).toBeGreaterThan(0);
      expect(pb.do_not.length).toBeGreaterThan(0);
      expect(pb.example_response.length).toBeGreaterThan(0);
    });
  });

  it("cobre objecoes documentadas no extractEntities", () => {
    const keys = OBJECTION_PLAYBOOKS.map((pb) => pb.key);
    // chaves declaradas no system prompt do extractEntitiesWithClaude
    expect(keys).toContain("nao_pode_visitar");
    expect(keys).toContain("esposo_decide");
    expect(keys).toContain("longe");
    expect(keys).toContain("nao_quer_financiar");
    expect(keys).toContain("orcamento_baixo");
  });

  it("nao tem keys duplicadas", () => {
    const keys = OBJECTION_PLAYBOOKS.map((pb) => pb.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keys sao slugs sem espaco/caps", () => {
    OBJECTION_PLAYBOOKS.forEach((pb) => {
      expect(pb.key).toMatch(/^[a-z_]+$/);
    });
  });

  it("example_response e curto (<=200 chars)", () => {
    OBJECTION_PLAYBOOKS.forEach((pb) => {
      expect(pb.example_response.length).toBeLessThanOrEqual(200);
    });
  });
});

describe("getRelevantPlaybooks", () => {
  it("array vazio retorna []", () => {
    expect(getRelevantPlaybooks([])).toEqual([]);
  });

  it("null/undefined retorna [] sem quebrar", () => {
    expect(getRelevantPlaybooks(null as any)).toEqual([]);
    expect(getRelevantPlaybooks(undefined as any)).toEqual([]);
  });

  it("apenas objecoes desconhecidas retorna []", () => {
    expect(getRelevantPlaybooks(["xyz_objecao_inexistente"])).toEqual([]);
  });

  it("uma objecao conhecida retorna 1 playbook", () => {
    const r = getRelevantPlaybooks(["nao_pode_visitar"]);
    expect(r).toHaveLength(1);
    expect(r[0].key).toBe("nao_pode_visitar");
  });

  it("multiplas objecoes retorna multiplos playbooks", () => {
    const r = getRelevantPlaybooks(["esposo_decide", "orcamento_baixo"]);
    expect(r).toHaveLength(2);
    const keys = r.map((pb) => pb.key).sort();
    expect(keys).toEqual(["esposo_decide", "orcamento_baixo"]);
  });

  it("matching e case-insensitive", () => {
    const r = getRelevantPlaybooks(["NAO_PODE_VISITAR", "Esposo_Decide"]);
    expect(r.length).toBe(2);
  });

  it("filtra entradas vazias/whitespace do array", () => {
    const r = getRelevantPlaybooks(["", "  ", "nao_pode_visitar"]);
    expect(r).toHaveLength(1);
  });

  it("mistura conhecidas + desconhecidas retorna so as conhecidas", () => {
    const r = getRelevantPlaybooks([
      "nao_pode_visitar",
      "xyz_invalido",
      "esposo_decide",
    ]);
    expect(r).toHaveLength(2);
  });

  it("nao retorna duplicados quando objecao repete no array", () => {
    const r = getRelevantPlaybooks([
      "nao_pode_visitar",
      "nao_pode_visitar",
      "nao_pode_visitar",
    ]);
    expect(r).toHaveLength(1);
  });
});

describe("formatObjectionPlaybooksBlock", () => {
  it("array vazio retorna string vazia", () => {
    expect(formatObjectionPlaybooksBlock([])).toBe("");
  });

  it("null retorna string vazia (defensivo)", () => {
    expect(formatObjectionPlaybooksBlock(null as any)).toBe("");
  });

  it("contem header e exemplo de resposta de cada playbook", () => {
    const pbs = getRelevantPlaybooks(["nao_pode_visitar"]);
    const block = formatObjectionPlaybooksBlock(pbs);
    expect(block).toContain("## PLAYBOOKS DE OBJEÇÃO");
    expect(block).toContain("Não pode visitar");
    expect(block).toContain("**Faça**");
    expect(block).toContain("**NUNCA**");
    expect(block).toContain("**Exemplo de resposta**");
    expect(block).toContain("Estes são padrões testados");
  });

  it("multiplos playbooks aparecem em ordem", () => {
    const pbs = getRelevantPlaybooks(["esposo_decide", "so_olhando"]);
    const block = formatObjectionPlaybooksBlock(pbs);
    const idxEsposo = block.indexOf("Esposo/companheiro");
    const idxSoOlhando = block.indexOf("Só olhando");
    expect(idxEsposo).toBeGreaterThan(-1);
    expect(idxSoOlhando).toBeGreaterThan(-1);
  });
});
