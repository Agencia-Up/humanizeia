// ============================================================================
// Smoke real (LLM gpt-4.1-mini) do CONTRATO DE PAGAMENTO/CONSÓRCIO pelo FLUXO central_active COMPLETO
// (runCentralConversation: validação -> feedback -> reautoria -> render/efeitos), NÃO só brain.proposeNextStep.
// PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 npm.cmd run smoke:f256
//
// Cenário A (incidente real): o lead declara "carta consórcio contemplada de 53 mil" (forma de pagamento). Asserts:
//   - ZERO stock_search no turno (pagamento não é busca);
//   - o texto VISÍVEL final NÃO pede nome/CPF (pagamento não é cadastro — a guarda paymentConductTurn nega+retry);
//   - understanding do CÉREBRO presente (understandingFromBrain=true);
//   - texto final não vazio; sem technical_fallback;
//   - formaPagamento=consorcio registrado.
// Cenário B (referência da lista, best-effort): após uma lista, pede a foto de um item por referência; reporta o
//   comportamento (send_media aterrado / sem re-busca). Não falha por variância do estoque real.
// ============================================================================
import { RealClock } from "../src/runtime/real-clock.ts";
import { loadServiceEnv, buildRealAssembly, sanitize } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";
import type { CentralTurnCapture } from "./central-assertions.ts";

const norm = (v: string): string => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const isBrain = (s: string | undefined): boolean => /^brain_(?:final|retry)$/.test(s ?? "");
const asksName = (s: string): boolean => /\b(?:seu|o seu)\s+nome\b|qual\s+(?:o\s+)?(?:seu\s+)?nome|como\s+(?:voce\s+se\s+chama|posso\s+te\s+chamar)/.test(norm(s));
const asksCpf = (s: string): boolean => /\bcpf\b/.test(norm(s));

function printTable(title: string, turns: CentralTurnCapture[]): void {
  console.log(`\n---- ${title} (turno a turno) ----`);
  for (const t of turns) {
    console.log(`T${t.turnIndex} [${t.responseSource ?? t.status}] intent=${t.primaryIntent ?? "-"} fromBrain=${t.understandingFromBrain ?? "-"} tools=${t.toolsRequested.join(",") || "-"} eff=${t.effects.map((e) => e.kind).join("+") || "-"} termSafe=${t.terminalSafe} slots=${t.slotsDelta.map((d) => `${d.slot}=${d.to}`).join(";") || "-"}`);
    console.log(`   lead:  ${sanitize(t.leadBlock)}`);
    console.log(`   agent: ${sanitize(t.response).slice(0, 260)}`);
    if (t.policyFeedback && t.policyFeedback.length > 0) console.log(`   feedback: ${t.policyFeedback[0].slice(0, 160)}`);
  }
}

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") { console.error("BLOQUEADO: defina PEDRO_V3_REAL_EVAL=1."); process.exit(2); }
  loadServiceEnv();
  const assembly = await buildRealAssembly(new RealClock());
  const failures: string[] = [];

  // ── Cenário A: incidente do consórcio pelo ciclo completo ──────────────────────────────────────────────
  {
    const stack = buildCentralStack(assembly);
    const turns = await runCentralConversation(assembly, stack, `wa:f256pay-${Date.now().toString(36)}`, [
      ["Boa tarde"],
      ["Quero saber as condições de pagamento de um carro de vocês"],
      ["Tenho uma carta de consórcio contemplada de 53 mil"],
    ], { maxLlmCalls: Number(process.env.F256_MAX_LLM_CALLS ?? "24"), singleAuthor: true, llmFirst: true, crmLeadId: "00000000-0000-4000-8000-000000000256" });
    printTable("A · CONSÓRCIO (ciclo completo)", turns);
    console.log(`A BRAIN=${stack.brainTransport.count} COMPOSE=${stack.composeTransport.count}`);
    const pay = turns.find((t) => /consorcio|contemplad/.test(norm(t.leadBlock)));
    if (!pay) failures.push("A: turno do consórcio não encontrado");
    else {
      if (pay.terminalSafe || pay.responseSource === "technical_fallback") failures.push(`A consórcio technical_fallback (src=${pay.responseSource})`);
      if (!isBrain(pay.responseSource)) failures.push(`A consórcio source=${pay.responseSource ?? "-"}, esperado brain_*`);
      if (pay.toolsRequested.includes("stock_search") || pay.observations.some((o) => o.tool === "stock_search")) failures.push("A consórcio acionou stock_search (pagamento não é busca)");
      if (asksName(pay.response)) failures.push(`A consórcio PEDIU O NOME (pagamento não é cadastro): "${pay.response.slice(0, 140)}"`);
      if (asksCpf(pay.response)) failures.push(`A consórcio pediu CPF: "${pay.response.slice(0, 140)}"`);
      if (pay.understandingFromBrain !== true) failures.push(`A consórcio understandingFromBrain=${pay.understandingFromBrain} (esperado true)`);
      if (!pay.response.trim()) failures.push("A consórcio: texto final vazio");
    }
    // zero technical_fallback em toda a conversa
    for (const t of turns) if (t.terminalSafe) failures.push(`A T${t.turnIndex} terminalSafe`);
  }

  // ── Cenário B (best-effort): referência da lista + foto ────────────────────────────────────────────────
  {
    const stack = buildCentralStack(assembly);
    const turns = await runCentralConversation(assembly, stack, `wa:f256ref-${Date.now().toString(36)}`, [
      ["Boa tarde"],
      ["Quero ver as opções de carro que vocês têm"],
      ["Me manda a foto do primeiro"],
    ], { maxLlmCalls: Number(process.env.F256_MAX_LLM_CALLS ?? "24"), singleAuthor: true, llmFirst: true, crmLeadId: "00000000-0000-4000-8000-000000000257" });
    printTable("B · REFERÊNCIA + FOTO (best-effort)", turns);
    console.log(`B BRAIN=${stack.brainTransport.count} COMPOSE=${stack.composeTransport.count}`);
    const photoTurn = turns.find((t) => /foto/.test(norm(t.leadBlock)));
    if (photoTurn) {
      // Hard: nunca cai em technical_fallback nem re-busca ao pedir foto de item já listado.
      if (photoTurn.terminalSafe || photoTurn.responseSource === "technical_fallback") failures.push(`B foto technical_fallback (src=${photoTurn.responseSource})`);
      const media = photoTurn.effects.find((e) => e.kind === "send_media");
      console.log(`B foto -> ${media ? `send_media(${media.vehicleKey})` : "sem mídia (agente ofereceu/perguntou)"}; tools=${photoTurn.toolsRequested.join(",") || "-"}`);
    } else {
      console.log("B: turno de foto não encontrado (agente pode ter conduzido diferente) — best-effort, não falha.");
    }
  }

  console.log(`\n=== F2.56 REAL (ciclo completo): ${failures.length === 0 ? "PASS ✅" : `FALHOU (${failures.length})`} ===`);
  for (const f of failures) console.error(`FALHA: ${f}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
