// ============================================================================
// F2.44 — limites semânticos de slots pré-CRM.
// Garante que perguntas/negações não virem fatos, que veículo de troca não
// contamine interesse de compra, e que interesse de compra não vire troca.
//   npx tsx tests/run-f2-44-semantic-slot-boundaries.ts
// ============================================================================
import { extractLeadSlots } from "../src/engine/lead-extraction.ts";
import { createInitialState, type ConversationState } from "../src/domain/conversation-state.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import type { DecisionMutation } from "../src/domain/decision.ts";

let ok = 0, fail = 0;
const failures: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); return; }
  fail++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`);
}

const NOW = "2026-07-09T12:00:00.000Z";
const TENANT = "tenant-f244";
const AGENT = "agent-f244";
const STOCK: VehicleFact[] = [
  { vehicleKey: "s:logan", marca: "Renault", modelo: "Logan", ano: 2015, preco: 42000, km: 100000, cambio: "Manual", cor: "Prata", tipo: "sedan" },
  { vehicleKey: "s:jeep", marca: "Jeep", modelo: "Compass", ano: 2021, preco: 98000, km: 70000, cambio: "Automatico", cor: "Branco", tipo: "suv" },
  { vehicleKey: "s:onix", marca: "Chevrolet", modelo: "Onix", ano: 2018, preco: 54000, km: 80000, cambio: "Manual", cor: "Branco", tipo: "hatch" },
];
const extractor = new CatalogClaimExtractor(buildTenantCatalog(STOCK));

function stateWith(agentText: string): ConversationState {
  const base = createInitialState({ conversationId: `c-${ok}-${fail}`, tenantId: TENANT, agentId: AGENT, now: NOW });
  return { ...base, recentTurns: [{ role: "agent", text: agentText } as never] };
}

function slots(agentText: string, lead: string): Record<string, unknown> {
  const muts = extractLeadSlots({
    leadMessage: lead,
    state: stateWith(agentText),
    interpretation: { relation: "ambiguous" } as never,
    claimExtractor: extractor,
    turnId: `t-${ok}-${fail}`,
  });
  const out: Record<string, unknown> = {};
  for (const m of muts) {
    if ((m as DecisionMutation).op === "set_slot") {
      const sm = m as Extract<DecisionMutation, { op: "set_slot" }>;
      out[sm.slot] = sm.value;
    }
  }
  return out;
}

function hasModel(value: unknown, model: string): boolean {
  return JSON.stringify(value ?? "").toLowerCase().includes(model.toLowerCase());
}

function main(): void {
  console.log("== F2.44: limites semânticos de slots pré-CRM ==");

  // P0-1 — pergunta/negação não viram fato.
  {
    const s = slots("Voce tem algum valor para dar de entrada?", "Entrada, ou sem entrada?");
    check("[P0-1a] pergunta sobre entrada nao grava entrada=0", s.entrada === undefined, JSON.stringify(s));
  }
  {
    const s = slots("Voce tem algum valor para dar de entrada?", "sem entrada?");
    check("[P0-1b] 'sem entrada?' e pergunta, nao resposta", s.entrada === undefined, JSON.stringify(s));
  }
  {
    const s = slots("De qual cidade voce fala?", "nao sou de Guaratingueta");
    check("[P0-1c] negacao de cidade nao grava cidade", s.cidade === undefined, JSON.stringify(s));
  }
  {
    const s = slots("De qual cidade voce fala?", "sou de Guaratingueta");
    check("[P0-1d] afirmacao de cidade grava cidade", String(s.cidade ?? "").toLowerCase().includes("guaratingueta"), JSON.stringify(s));
  }
  {
    const s = slots("Voce tem algum valor para dar de entrada?", "nao tenho entrada");
    check("[P0-1e] negacao clara a pergunta de entrada grava entrada=0", s.entrada === 0, JSON.stringify(s));
  }
  {
    const s = slots("Voce tem algum carro para dar de troca?", "Nao tenho carro pra troca\nvoce tem SUV ate 100k?");
    check("[P0-1f] negacao de troca em bloco misto grava possuiTroca=false", s.possuiTroca === false, JSON.stringify(s));
    check("[P0-1g] bloco misto preserva busca de compra por SUV", s.tipoVeiculo === "suv" && JSON.stringify(s.faixaPreco ?? "").includes("100000"), JSON.stringify(s));
  }

  // P0-2 — dados de troca sem "tenho" ainda sao troca se respondem a pergunta de troca.
  {
    const s = slots("Voce tem algum carro para dar de troca?", "Logan 2015 100 mil km");
    check("[P0-2a] descricao de carro apos pergunta de troca grava veiculoTroca", hasModel(s.veiculoTroca, "Logan"), JSON.stringify(s));
    check("[P0-2b] descricao de carro apos pergunta de troca grava possuiTroca=true", s.possuiTroca === true, JSON.stringify(s));
    check("[P0-2c] carro de troca nao contamina interesse", s.interesse === undefined, JSON.stringify(s));
  }
  {
    const s = slots("Voce tem algum carro para dar de troca?", "tem Logan 2015?");
    check("[P0-2d] pergunta de disponibilidade nao grava veiculoTroca", s.veiculoTroca === undefined && s.possuiTroca === undefined, JSON.stringify(s));
    check("[P0-2e] pergunta de disponibilidade alimenta interesse de compra", hasModel(s.interesse, "Logan"), JSON.stringify(s));
  }
  {
    const s = slots("Voce tem algum carro para dar de troca?", "quero Logan");
    check("[P0-2f] verbo de compra apos pergunta de troca nao vira troca", s.veiculoTroca === undefined && s.possuiTroca === undefined, JSON.stringify(s));
    check("[P0-2g] verbo de compra grava interesse", hasModel(s.interesse, "Logan"), JSON.stringify(s));
  }

  // P0-3 — interesse nao vira troca; clausulas mistas separam compra e troca.
  {
    const s = slots("Voce tem algum carro para dar de troca?", "me interessou o Jeep");
    check("[P0-3a] interesse por Jeep nao vira veiculoTroca", s.veiculoTroca === undefined && s.possuiTroca === undefined, JSON.stringify(s));
    check("[P0-3b] interesse por Jeep vira alvo comercial", hasModel(s.interesse, "Jeep"), JSON.stringify(s));
  }
  {
    const s = slots("Voce tem algum carro para dar de troca?", "gostei do Jeep");
    check("[P0-3c] gostei do Jeep nao vira troca", s.veiculoTroca === undefined && s.possuiTroca === undefined, JSON.stringify(s));
    check("[P0-3d] gostei do Jeep vira interesse", hasModel(s.interesse, "Jeep"), JSON.stringify(s));
  }
  {
    const s = slots("Voce tem algum carro para dar de troca?", "tenho um Logan para troca, mas me interessou o Jeep");
    check("[P0-3e] clausula de posse grava Logan como troca", hasModel(s.veiculoTroca, "Logan") && s.possuiTroca === true, JSON.stringify(s));
    check("[P0-3f] clausula de interesse grava Jeep como compra", hasModel(s.interesse, "Jeep"), JSON.stringify(s));
  }
  {
    const s = slots("Voce tem algum carro para dar de troca?", "meu Jeep e 2018");
    check("[P0-3g] possessivo 'meu Jeep' vira troca", hasModel(s.veiculoTroca, "Jeep") && s.possuiTroca === true, JSON.stringify(s));
  }

  console.log(`\n== F2.44: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) {
    for (const f of failures) console.error("  FALHOU: " + f);
    process.exit(1);
  }
}

main();
