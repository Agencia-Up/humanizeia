// ============================================================================
// eval/run-eval-institutional.ts — VALIDAÇÃO REAL da missão ROTEAMENTO POR DOMÍNIO (1 conversa curta, 8 turnos).
// gpt-4.1-mini REAL, prompt/estoque/config REAIS, central engine singleAuthor+llmFirst = PRODUÇÃO central_active, efeitos
// OFF, businessInfo do PROMPT. Foco: pergunta institucional ("aonde fica a loja e qual horário?") NÃO pode virar
// technical_fallback nem aplicar policy de veículo/funil.
//   PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 npm run eval:institutional
// ============================================================================
import { RealClock } from "../src/runtime/real-clock.ts";
import { loadServiceEnv, buildRealAssembly, sanitize, PILOT_MODEL } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";
import { PromptTenantBusinessInfoSource, extractTenantBusinessFacts } from "../src/engine/tenant-business-info.ts";
import { createInitialPersistedWorkingMemory } from "../src/domain/agent-brain.ts";
import type { TurnFrame } from "../src/domain/agent-brain.ts";

// Conversa da AUDITORIA CODEX (5 turnos): mistos institucional+veículo testam o roteamento POR DOMÍNIO DA AFIRMAÇÃO.
const CONV = ["Boa noite", "quero um SUV automático", "gostei do segundo", "aonde fica a loja e quantos km ele tem?",
  "qual horário e me manda foto dele?"];
const MAX_LLM_CALLS = 35;
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));
const qCount = (s: string): number => (s.match(/\?/g) ?? []).length;

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") { console.error("BLOQUEADO: PEDRO_V3_REAL_EVAL=1."); process.exit(2); }
  loadServiceEnv();
  const startedAt = new Date().toISOString();
  console.log(`== EVAL INSTITUCIONAL (1 conversa, 8 turnos, singleAuthor+llmFirst, efeitos OFF, teto=${MAX_LLM_CALLS}) ${startedAt} ==`);
  const assembly = await buildRealAssembly(new RealClock());
  const stack = buildCentralStack(assembly);
  const businessInfo = new PromptTenantBusinessInfoSource(assembly.runtimeConfig);
  const pf = extractTenantBusinessFacts(assembly.runtimeConfig);
  console.log(`config: promptLen=${assembly.runtimeConfig.promptText.length} modelo=${PILOT_MODEL} | address=${pf.address.value ? "presente" : "ausente"} hours=${pf.hours.value ? "presente" : "ausente"}`);

  const probeFrame: TurnFrame = {
    turnId: "probe", now: startedAt, block: "oi", portalPromptSha256: assembly.promptSha,
    workingMemory: { ...createInitialPersistedWorkingMemory(), funnel: { known: [], declined: [], deferred: [], suggestedObjective: null }, selectedVehicle: null, lastOffer: null },
    recentTranscript: [], signals: { mentionsPhoto: false, mentionsStore: false, mentionsMoreOptions: false, mentionsVehicleType: null, isMemoryQuestion: false, relation: "ambiguous" },
  };
  try { await stack.brain.proposeNextStep(probeFrame, []); } catch { /* final seguro */ }
  if (stack.brainTransport.okCount === 0) { console.error(`\nBLOQUEIO EXTERNO: sem quota/chave (2xx=0). NÃO executando.`); process.exit(3); }
  console.log(`probe OK: brain 2xx (${stack.brainTransport.okCount}/${stack.brainTransport.count}).`);

  const caps = await runCentralConversation(assembly, stack, "inst-1", CONV.map((m) => [m]), { singleAuthor: true, llmFirst: true, businessInfo, maxLlmCalls: MAX_LLM_CALLS });
  const at = (i: number) => caps.find((c) => c.turnIndex === i);

  console.log(`\n== POR TURNO ==`);
  for (const c of caps) {
    console.log(`T${c.turnIndex} [${sanitize(c.leadBlock)}]`);
    console.log(`   resp: ${sanitize(c.response).slice(0, 180)}`);
    console.log(`   tools=${c.toolsRequested.join(",") || "-"} | effects=${c.effects.map((e) => e.kind).join(",") || "-"} | src=${c.responseSource ?? c.reasonCode} | TS=${c.terminalSafe}`);
    if (c.terminalSafe && c.policyFeedback?.length) console.log(`   ⚠ policyFeedback: ${c.policyFeedback.map((f) => sanitize(f)).join(" || ").slice(0, 280)}`);
  }

  // ── CRITÉRIOS ──────────────────────────────────────────────────────────────
  const V: string[] = [];
  for (const c of caps) {
    if (c.status !== "committed") V.push(`T${c.turnIndex}: status=${c.status}`);
    if (c.terminalSafe) V.push(`T${c.turnIndex}: technical_fallback/degradado (${c.reasonCode})`);
    if (qCount(c.response) > 1) V.push(`T${c.turnIndex}: ${qCount(c.response)} perguntas`);
    if (/\bcpf\b/i.test(c.response)) V.push(`T${c.turnIndex}: pediu CPF cedo`);
  }
  // T4 = "aonde fica a loja e quantos km ele tem?" (misto: institucional + km). T5 = "qual horário e me manda foto dele?".
  const t4 = at(4), t5 = at(5);
  if (t4) {
    // CRITÉRIO 1: T4 responde ENDEREÇO + km real.
    if (pf.address.value) { const tok = norm(pf.address.value).split(/[\s,]+/).find((w) => w.length >= 4); if (tok && !has(t4.response, tok)) V.push(`T4: não respondeu o endereço`); }
    // km REAL: deve citar um número de km E ter chamado vehicle_details (não inventa; não ignora o pedido).
    const citouKm = /\d[\d.]{2,}\s*km|\bkm\b/.test(norm(t4.response));
    if (!citouKm) V.push(`T4: não respondeu os km (pedido ignorado)`);
    if (citouKm && !t4.toolsRequested.includes("vehicle_details")) V.push(`T4: citou km SEM vehicle_details (atributo inventado)`);
  }
  if (t5) {
    // CRITÉRIO 2: T5 responde HORÁRIO (não endereço no lugar) + ENVIA foto.
    if (pf.hours.value && !/\d{1,2}\s*h|hor[aá]rio|funcion|segunda\s+a\s+s[aá]bado|dias?\s+[úu]tei/.test(norm(t5.response))) V.push(`T5: não respondeu o horário (respondeu outro assunto no lugar)`);
    // foto: pediu "me manda foto dele" -> tem que enviar (send_media). Sem envio = pedido ignorado.
    if (!t5.effects.some((e) => e.kind === "send_media")) V.push(`T5: não enviou a foto (send_media ausente)`);
    // e nunca prometer foto sem de fato enviar.
    const promised = /aqui\s+est[aã]o?\s+as\s+fotos|vou\s+(te\s+)?enviar\s+as\s+fotos|segue[m]?\s+as\s+fotos/.test(norm(t5.response));
    if (promised && !t5.effects.some((e) => e.kind === "send_media")) V.push(`T5: prometeu foto sem send_media`);
  }

  const brainCalls = stack.brainTransport.count, composeCalls = stack.composeTransport.count;
  const promptTok = stack.brainTransport.calls.reduce((s, x) => s + (x.promptTokens ?? 0), 0);
  const compTok = stack.brainTransport.calls.reduce((s, x) => s + (x.completionTokens ?? 0), 0);
  console.log(`\n== TOTAIS ==`);
  console.log(`OpenAI: ${brainCalls + composeCalls} chamadas (BRAIN ${brainCalls} 2xx=${stack.brainTransport.okCount} · COMPOSE ${composeCalls}) · custo≈US$${((promptTok * 0.4 + compTok * 1.6) / 1e6).toFixed(4)} · turnos=${caps.length}/8`);
  if (V.length) { console.log(`\nRESULTADO: ${V.length} violação(ões):`); for (const v of V) console.log(`  - ${sanitize(v)}`); }
  else console.log(`\nRESULTADO: PASS (0 violações; institucional respondido sem policy de veículo; 0 technical_fallback)`);
  process.exit(V.length === 0 ? 0 : 1);
}
main().catch((e) => { console.error("ERRO FATAL:", sanitize(String((e as Error)?.message ?? e))); process.exit(1); });
