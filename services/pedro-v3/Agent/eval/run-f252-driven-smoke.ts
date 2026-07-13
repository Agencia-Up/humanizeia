// ============================================================================
// F2.52 DRIVEN — smoke real (LLM gpt-4.1-mini) em DOIS modos que provam P0-A (continuação de agendamento) de ponta a ponta:
//  • ADAPTATIVO: o driver acompanha o SLOT que o agente perguntou (WM.pendingAgentQuestion — telemetria, NÃO regex),
//    respondendo nome/dia/horário conforme pedido, e conduz compra -> visita -> handoff.
//  • ADVERSARIAL: o lead IGNORA a pergunta pendente (agente pode pedir nome; o lead responde "Pra segunda" e depois
//    "Às 15h"). O agente DEVE entender que é o agendamento — sem technical_fallback, sem voltar à descoberta, sem perder
//    o carro selecionado.
// Efeitos OFF, vendedor/lead sintéticos (in-memory), receipts simulados. Roda com PEDRO_V3_REAL_EVAL=1.
// ============================================================================
import { RealClock } from "../src/runtime/real-clock.ts";
import { loadServiceEnv, buildRealAssembly } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";
import type { CentralTurnCapture } from "./central-assertions.ts";

const norm = (v: string): string => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const isBrain = (s: string | undefined): boolean => /^brain_(?:final|retry)$/.test(s ?? "");
// ⭐MISSÃO FINAL (resposta VISÍVEL): o agente NUNCA repergunta uma dimensão do agendamento já respondida.
const asksDay = (v: string): boolean => /qual\s+(?:o\s+)?(?:melhor\s+)?dia|que\s+dia|em\s+que\s+dia|pra\s+que\s+dia|para\s+que\s+dia/.test(norm(v));
const asksTime = (v: string): boolean => /qual\s+(?:o\s+)?(?:melhor\s+)?hor|que\s+hor|que\s+horas|qual\s+horario|a\s+que\s+horas/.test(norm(v));
const HANDOFF = { enabled: true, available: true, precheck: { available: true, reason: "available" } as never };
const LEAD = "00000000-0000-4000-8000-0000000000d2";

function printTable(title: string, turns: CentralTurnCapture[]): void {
  console.log(`\n---- ${title} (turno a turno) ----`);
  for (const t of turns) {
    const eff = t.effects.map((e) => e.kind).join("+") || "-";
    const dh = (t.slotsDelta.find((d) => d.slot === "diaHorario")?.to) ?? "";
    console.log(`T${t.turnIndex} [${t.responseSource ?? t.status}] intent=${t.primaryIntent ?? "-"} tools=${t.toolsRequested.join(",") || "-"} eff=${eff} pending=${t.pendingAgentQuestion ?? "-"} sel=${t.selectedVehicleKeyAfter ?? "-"} termSafe=${t.terminalSafe} dh=${dh}`);
    console.log(`   lead: ${t.leadBlock}`);
    console.log(`   agent: ${t.response.slice(0, 200)}`);
    if (t.policyFeedback && t.policyFeedback.length > 0) console.log(`   feedback: ${t.policyFeedback[0].slice(0, 140)}`);
  }
}

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") { console.error("BLOQUEADO: defina PEDRO_V3_REAL_EVAL=1."); process.exit(2); }
  loadServiceEnv();
  const assembly = await buildRealAssembly(new RealClock());
  const failures: string[] = [];

  // ── MODO ADAPTATIVO ── o driver ACOMPANHA o slot que o agente perguntou (WM.pendingAgentQuestion — telemetria) e responde
  //    via mapa slot->resposta; quando o agente NÃO pergunta um slot do funil, o driver PROGRIDE a jornada (busca->seleção->
  //    visita) por estado CUMULATIVO; ao pedir a visita, conduz dia->horário->humano. Robusto à ordem não-determinística da LLM.
  {
    const stack = buildCentralStack(assembly);
    // respostas por slot pedido (telemetria). O agendamento (diaHorario) é tratado à parte (dia depois horário).
    const slotAnswer: Record<string, string> = {
      nome: "Douglas", conheceLoja: "Sim, conheço a loja", cidade: "Sou de Taubaté",
      possuiTroca: "Não tenho carro para troca", entrada: "Não tenho entrada", parcelaDesejada: "Até 1500",
      formaPagamento: "Quero financiar", interesse: "Quero um SUV", tipoVeiculo: "Um SUV", faixaPreco: "Até 100 mil",
      interesseVisita: "Sim, quero agendar uma visita",
    };
    let selectedEver = false, listShownEver = false, searchAttempts = 0, selectAttempts = 0;
    const said = { visit: false, day: false, time: false, human: false };
    const answered = new Set<string>();
    const SEARCH_SLOTS = new Set(["interesse", "tipoVeiculo", "faixaPreco", "conheceLoja", "cidade"]);   // critério de busca (destrava a lista)
    const showsList = (l: CentralTurnCapture | null): boolean => (l?.response.match(/r\$\s*[\d.]+/gi) ?? []).length >= 2 || /\b1[.)]\s/.test(l?.response ?? "");
    const driver = (ctx: { turnIndex: number; last: CentralTurnCapture | null; pendingSlot: string | null }): readonly string[] | null => {
      const { last, pendingSlot, turnIndex } = ctx;
      if (last == null) return ["Boa tarde"];
      if (last.selectedVehicleKeyAfter) selectedEver = true;
      if (showsList(last)) listShownEver = true;
      if (said.human || turnIndex > 22) return null;                                     // fim (ou teto de segurança)
      // 1) visita pedida -> CONDUZ o agendamento (dia -> horário -> humano); o P0-A garante entender cada bloco.
      if (said.visit) {
        if (!said.day) { said.day = true; return ["Pra segunda"]; }
        if (!said.time) { said.time = true; return ["Às 15h"]; }
        said.human = true; return ["Quero falar com um vendedor"];
      }
      if (pendingSlot === "diaHorario") { if (!said.day) { said.day = true; return ["Pra segunda"]; } if (!said.time) { said.time = true; return ["Às 15h"]; } }
      // 2) PRÉ-LISTA: responde os slots de CRITÉRIO de busca (telemetria) para a LISTA aparecer; senão pede a lista.
      if (!listShownEver) {
        if (pendingSlot && SEARCH_SLOTS.has(pendingSlot) && slotAnswer[pendingSlot] && !answered.has(pendingSlot)) { answered.add(pendingSlot); return [slotAnswer[pendingSlot]]; }
        if (searchAttempts < 5) { searchAttempts += 1; return searchAttempts === 1 ? ["Quero um SUV até 100 mil"] : ["Me mostra as opções de SUV que você tem"]; }
      }
      // 3) LISTA mostrada -> SELECIONA (ordinal explícito), retry.
      if (listShownEver && !selectedEver && selectAttempts < 4) { selectAttempts += 1; return ["Quero o primeiro da lista"]; }
      // 4) PÓS-SELEÇÃO: ACOMPANHA o slot pedido (troca/entrada/parcela/nome...) uma vez cada; senão pede a visita.
      if (pendingSlot && slotAnswer[pendingSlot] && !answered.has(pendingSlot)) { answered.add(pendingSlot); return [slotAnswer[pendingSlot]]; }
      said.visit = true; return ["Quero agendar uma visita"];
    };
    const turns = await runCentralConversation(assembly, stack, `wa:f252adapt-${Date.now().toString(36)}`, [], {
      maxLlmCalls: Number(process.env.F252D_MAX_LLM_CALLS ?? "60"), singleAuthor: true, llmFirst: true, crmLeadId: LEAD, handoff: HANDOFF, driver,
    });
    printTable("ADAPTATIVO", turns);
    console.log(`ADAPTATIVO BRAIN=${stack.brainTransport.count} COMPOSE=${stack.composeTransport.count}`);
    // Invariantes P0-A/portal-first: nenhum turno em technical_fallback; visita entendida; carro selecionado preservado; handoff.
    for (const t of turns) if (t.terminalSafe || t.responseSource === "technical_fallback") failures.push(`ADAPT T${t.turnIndex} technical_fallback/terminalSafe`);
    const selKey = turns.map((t) => t.selectedVehicleKeyAfter).filter(Boolean).pop() ?? null;
    if (!selKey) failures.push("ADAPT: nenhum veículo ficou selecionado");
    const dhFinal = turns.map((t) => t.slotsDelta.find((d) => d.slot === "diaHorario")?.to).filter(Boolean).pop() ?? "";
    if (!(norm(dhFinal).includes("segunda") && /1[45]/.test(dhFinal))) failures.push(`ADAPT: diaHorario não compôs dia+horário (${dhFinal})`);
    const lastSel = turns.filter((t) => /pra segunda|as 15|às 15/.test(norm(t.leadBlock)));
    for (const t of lastSel) if (t.selectedVehicleKeyAfter !== selKey && selKey) failures.push(`ADAPT T${t.turnIndex}: agendamento perdeu o carro selecionado`);
    // ⭐resposta VISÍVEL (MISSÃO FINAL): o turno do DIA não repergunta o dia; o turno do HORÁRIO não repergunta dia NEM horário.
    const segA = turns.find((t) => norm(t.leadBlock).includes("pra segunda"));
    const qzA = turns.find((t) => /as 15|às 15|15h/.test(norm(t.leadBlock)));
    if (segA && asksDay(segA.response)) failures.push(`ADAPT 'Pra segunda' REPERGUNTOU o dia ja informado: "${segA.response.slice(0, 160)}"`);
    if (qzA && asksDay(qzA.response)) failures.push(`ADAPT 'Às 15h' REPERGUNTOU o dia ja conhecido: "${qzA.response.slice(0, 160)}"`);
    if (qzA && asksTime(qzA.response)) failures.push(`ADAPT 'Às 15h' REPERGUNTOU o horario que o cliente ACABOU de dar: "${qzA.response.slice(0, 160)}"`);
    const handoffTurn = turns.find((t) => t.effects.some((e) => e.kind === "handoff"));
    if (!handoffTurn) failures.push("ADAPT: pedido humano não gerou handoff");
  }

  // ── MODO ADVERSARIAL ── o lead ignora a pergunta pendente; "Pra segunda"/"Às 15h" isolados após pedir visita.
  {
    const stack = buildCentralStack(assembly);
    // Prefixo FIXO (o lead IGNORA a pergunta pendente: "Pra segunda"/"Às 15h" isolados). Depois, pedido humano com RETRY
    // até o handoff materializar (a LLM às vezes pede o nome antes de transferir — reforço explícito).
    const advPrefix: readonly (readonly string[])[] = [
      ["Boa tarde"], ["Quero um SUV até 100 mil"], ["Gostei do primeiro"], ["Quero agendar uma visita"], ["Pra segunda"], ["Às 15h"],
    ];
    let advIdx = 0, humanTries = 0, handoffSeen = false;
    const advDriver = (ctx: { turnIndex: number; last: CentralTurnCapture | null; pendingSlot: string | null }): readonly string[] | null => {
      if (ctx.last?.effects.some((e) => e.kind === "handoff")) handoffSeen = true;
      if (advIdx < advPrefix.length) return advPrefix[advIdx++];
      if (handoffSeen || humanTries >= 4) return null;
      humanTries += 1;
      return humanTries === 1 ? ["Quero falar com um vendedor"]
        : humanTries === 2 ? ["Quero falar com um atendente humano agora, sem cadastro"]
        : ["Pode me transferir para o vendedor agora, por favor"];
    };
    const turns = await runCentralConversation(assembly, stack, `wa:f252adv-${Date.now().toString(36)}`, [], {
      maxLlmCalls: Number(process.env.F252D_MAX_LLM_CALLS ?? "48"), singleAuthor: true, llmFirst: true, crmLeadId: LEAD, handoff: HANDOFF, driver: advDriver,
    });
    printTable("ADVERSARIAL", turns);
    console.log(`ADVERSARIAL BRAIN=${stack.brainTransport.count} COMPOSE=${stack.composeTransport.count}`);
    const byLead = (frag: string): CentralTurnCapture | undefined => turns.find((t) => norm(t.leadBlock).includes(frag));
    const selKey = turns.map((t) => t.selectedVehicleKeyAfter).filter(Boolean)[0] ?? null;
    const seg = byLead("pra segunda"); const qz = byLead("15");
    // ⭐P0-A: "Pra segunda" isolado NÃO cai em technical_fallback e NÃO volta à descoberta; e — endurecimento MISSÃO FINAL —
    //    o texto VISÍVEL NÃO repergunta o DIA (o cliente ACABOU de dá-lo).
    if (seg) {
      if (seg.terminalSafe || seg.responseSource === "technical_fallback") failures.push(`ADV 'Pra segunda' technical_fallback (src=${seg.responseSource})`);
      if (seg.toolsRequested.includes("stock_search")) failures.push("ADV 'Pra segunda' virou busca (stock_search)");
      if (/o que voce procura|que tipo de|modelo ou tipo/.test(norm(seg.response))) failures.push("ADV 'Pra segunda' voltou à descoberta");
      if (asksDay(seg.response)) failures.push(`ADV 'Pra segunda' REPERGUNTOU o dia ja informado: "${seg.response.slice(0, 160)}"`);
      if (selKey && seg.selectedVehicleKeyAfter && seg.selectedVehicleKeyAfter !== selKey) failures.push("ADV 'Pra segunda' perdeu o carro selecionado");
    } else failures.push("ADV: turno 'Pra segunda' não encontrado");
    // ⭐"Às 15h" isolado: endurecimento MISSÃO FINAL (resposta VISÍVEL) — visit + brain + zero fallback + diaHorario dia+hora +
    //    NÃO repergunta dia NEM horário conhecidos + não volta à descoberta + preserva o carro.
    if (qz) {
      if (qz.terminalSafe || qz.responseSource === "technical_fallback") failures.push(`ADV 'Às 15h' technical_fallback (src=${qz.responseSource})`);
      if (qz.primaryIntent !== "visit") failures.push(`ADV 'Às 15h' intent=${qz.primaryIntent ?? "-"}, esperado visit`);
      if (!isBrain(qz.responseSource)) failures.push(`ADV 'Às 15h' source=${qz.responseSource ?? "-"}, esperado brain_*`);
      if (asksDay(qz.response)) failures.push(`ADV 'Às 15h' REPERGUNTOU o dia ja conhecido: "${qz.response.slice(0, 160)}"`);
      if (asksTime(qz.response)) failures.push(`ADV 'Às 15h' REPERGUNTOU o horario que o cliente ACABOU de dar: "${qz.response.slice(0, 160)}"`);
      if (/o que voce procura|que tipo de|modelo ou tipo/.test(norm(qz.response))) failures.push("ADV 'Às 15h' voltou à descoberta");
      if (selKey && qz.selectedVehicleKeyAfter && qz.selectedVehicleKeyAfter !== selKey) failures.push("ADV 'Às 15h' perdeu o carro selecionado");
    } else failures.push("ADV: turno 'Às 15h' não encontrado");
    const dhFinal = turns.map((t) => t.slotsDelta.find((d) => d.slot === "diaHorario")?.to).filter(Boolean).pop() ?? "";
    if (!(norm(dhFinal).includes("segunda") && /1[45]/.test(dhFinal))) failures.push(`ADV: diaHorario não compôs dia+horário (${dhFinal})`);
    const handoffTurn = turns.find((t) => t.effects.some((e) => e.kind === "handoff"));
    if (!handoffTurn) failures.push("ADV: pedido humano não gerou handoff");
  }

  console.log(`\n=== F2.52 DRIVEN: ${failures.length === 0 ? "PASS ✅" : `FALHOU (${failures.length})`} ===`);
  for (const f of failures) console.log(`FALHA: ${f}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
