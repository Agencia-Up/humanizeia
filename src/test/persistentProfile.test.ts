// Testes do perfil persistente (IT-3.1).

import { describe, it, expect } from "vitest";
import {
  derivePersistentProfile,
  formatPersistentProfileBlock,
} from "../../supabase/functions/_shared/memory/persistentProfile";

describe("derivePersistentProfile", () => {
  it("arrays vazios retorna null", () => {
    expect(derivePersistentProfile([], [])).toBeNull();
  });

  it("apenas 1 lead sem state retorna perfil minimo", () => {
    const p = derivePersistentProfile(
      [{ lead_name: "Roberta", client_city: "Taubaté", last_interaction_at: "2026-05-10T12:00:00Z" }],
      []
    );
    expect(p).not.toBeNull();
    expect(p!.total_previous_conversations).toBe(1);
    expect(p!.known_name).toBe("Roberta");
    expect(p!.known_city).toBe("Taubaté");
    expect(p!.last_seen_at).toBe("2026-05-10T12:00:00Z");
    expect(p!.days_since_last_seen).toBeGreaterThanOrEqual(0);
  });

  it("nome do state.lead.nome_completo tem prioridade sobre lead_name", () => {
    const p = derivePersistentProfile(
      [{ lead_name: "Roberta", last_interaction_at: "2026-05-10T12:00:00Z" }],
      [{ state: { lead: { nome_completo: "Roberta Silva Souza" } } }]
    );
    expect(p!.known_name).toBe("Roberta Silva Souza");
  });

  it("modelos perguntados deduplica de states + leads", () => {
    const p = derivePersistentProfile(
      [
        { lead_name: "X", vehicle_interest: "Onix", last_interaction_at: "2026-05-10" },
        { lead_name: "X", vehicle_interest: "Strada", last_interaction_at: "2026-05-05" },
        { lead_name: "X", vehicle_interest: "Onix", last_interaction_at: "2026-04-01" }, // duplicado
      ],
      [
        { state: { interesse: { modelo_desejado: "Civic" } } },
        { state: { interesse: { modelo_desejado: "Strada" } } }, // duplicado
      ]
    );
    expect(p!.previously_asked_models.sort()).toEqual(["Civic", "Onix", "Strada"]);
  });

  it("veiculos apresentados deduplica por modelo+ano", () => {
    const p = derivePersistentProfile(
      [{ lead_name: "X", last_interaction_at: "2026-05-10" }],
      [
        { state: { veiculo_apresentado: { ja_apresentado: true, modelo: "Onix", ano: 2022, preco: "78.900" } } },
        { state: { veiculo_apresentado: { ja_apresentado: true, modelo: "Onix", ano: 2022, preco: "OUTRO" } } }, // dup
        { state: { veiculo_apresentado: { ja_apresentado: true, modelo: "Strada", ano: 2023 } } },
        { state: { veiculo_apresentado: { ja_apresentado: false, modelo: "Civic" } } }, // skip (nao apresentado)
      ]
    );
    expect(p!.previously_shown_vehicles).toHaveLength(2);
    const modelos = p!.previously_shown_vehicles.map((v) => v.modelo).sort();
    expect(modelos).toEqual(["Onix", "Strada"]);
  });

  it("payment_method pega o mais recente (states tem precedencia)", () => {
    const p = derivePersistentProfile(
      [{ lead_name: "X", payment_method: "boleto", last_interaction_at: "2026-05-10" }],
      [{ state: { negociacao: { forma_pagamento: "à vista" } } }]
    );
    expect(p!.known_payment_method).toBe("à vista");
  });

  it("decision_maker so vem de states", () => {
    const p = derivePersistentProfile(
      [{ lead_name: "Maria", last_interaction_at: "2026-05-10" }],
      [{ state: { lead: { acompanhante_decisao: "esposo" } } }]
    );
    expect(p!.known_decision_maker).toBe("esposo");
  });

  it("objecoes unidas e deduplicadas de varios states", () => {
    const p = derivePersistentProfile(
      [{ lead_name: "X", last_interaction_at: "2026-05-10" }],
      [
        { state: { atendimento: { objecoes: ["mora_longe", "esposa_decide"] } } },
        { state: { atendimento: { objecoes: ["mora_longe", "preco_alto"] } } }, // dup mora_longe
      ]
    );
    expect(p!.known_objections.sort()).toEqual(["esposa_decide", "mora_longe", "preco_alto"]);
  });

  it("has_been_transferred_before=true se algum lead tem status='transferido'", () => {
    const p = derivePersistentProfile(
      [
        { lead_name: "X", status: "novo", last_interaction_at: "2026-05-10" },
        { lead_name: "X", status: "transferido", last_interaction_at: "2026-04-01" },
      ],
      []
    );
    expect(p!.has_been_transferred_before).toBe(true);
  });

  it("has_been_transferred_before=false se nenhum lead transferido", () => {
    const p = derivePersistentProfile(
      [{ lead_name: "X", status: "novo", last_interaction_at: "2026-05-10" }],
      []
    );
    expect(p!.has_been_transferred_before).toBe(false);
  });

  it("days_since_last_seen calcula a partir do last_interaction_at mais recente", () => {
    const ontemISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const p = derivePersistentProfile(
      [{ lead_name: "X", last_interaction_at: ontemISO }],
      []
    );
    expect(p!.days_since_last_seen).toBeGreaterThanOrEqual(0);
    expect(p!.days_since_last_seen).toBeLessThanOrEqual(1);
  });

  it("ignora campos vazios/null/whitespace", () => {
    const p = derivePersistentProfile(
      [
        { lead_name: "", client_city: null, last_interaction_at: "2026-05-10" },
        { lead_name: "  ", vehicle_interest: "", last_interaction_at: "2026-05-09" },
      ],
      [{ state: { lead: { nome: "Real Name" } } }]
    );
    expect(p!.known_name).toBe("Real Name");
    expect(p!.previously_asked_models).toEqual([]);
  });
});

describe("formatPersistentProfileBlock", () => {
  it("retorna string vazia quando nada util", () => {
    const empty = derivePersistentProfile(
      [{ lead_name: "", last_interaction_at: "2026-05-10" }],
      []
    );
    expect(formatPersistentProfileBlock(empty!)).toBe("");
  });

  it("inclui header e fields preenchidos", () => {
    const p = derivePersistentProfile(
      [
        {
          lead_name: "Roberta",
          client_city: "Taubaté",
          last_interaction_at: "2026-05-10T12:00:00Z",
          status: "transferido",
        },
      ],
      [
        { state: { lead: { nome: "Roberta", acompanhante_decisao: "esposo" }, negociacao: { forma_pagamento: "financiado" } } },
      ]
    );
    const block = formatPersistentProfileBlock(p!);
    expect(block).toContain("## PERFIL CONHECIDO");
    expect(block).toContain("Roberta");
    expect(block).toContain("Taubaté");
    expect(block).toContain("esposo");
    expect(block).toContain("financiado");
    expect(block).toContain("Já foi transferido");
    expect(block).toContain("Use esses dados como CONTEXTO");
  });

  it("formato 'hoje' / 'ontem' / 'X dias atras'", () => {
    const hojeISO = new Date().toISOString();
    const ontemISO = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    const pHoje = derivePersistentProfile(
      [{ lead_name: "X", last_interaction_at: hojeISO }],
      []
    );
    expect(formatPersistentProfileBlock(pHoje!)).toContain("hoje");

    const pOntem = derivePersistentProfile(
      [{ lead_name: "Y", last_interaction_at: ontemISO }],
      []
    );
    expect(formatPersistentProfileBlock(pOntem!)).toContain("ontem");
  });

  it("inclui modelos perguntados e veiculos apresentados como linhas legiveis", () => {
    const p = derivePersistentProfile(
      [{ lead_name: "X", vehicle_interest: "Onix", last_interaction_at: "2026-05-10" }],
      [
        {
          state: {
            interesse: { modelo_desejado: "Strada" },
            veiculo_apresentado: { ja_apresentado: true, modelo: "Strada Freedom CD", ano: 2023, preco: "98.500" },
          },
        },
      ]
    );
    const block = formatPersistentProfileBlock(p!);
    expect(block).toContain("Modelos já perguntados");
    expect(block).toContain("Onix");
    expect(block).toContain("Strada");
    expect(block).toContain("Veículos apresentados antes");
    expect(block).toContain("Strada Freedom CD 2023");
    expect(block).toContain("R$ 98.500");
  });
});
