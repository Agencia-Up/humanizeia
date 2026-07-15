// Low-cost, no-side-effect production canary for Carvalho/Bruno.
// It uses Bruno's real portal prompt, BNDV feed, and configured model; CRM and
// WhatsApp dispatch remain in memory so no customer or seller receives anything.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RealClock } from "../src/runtime/real-clock.ts";
import type { TenantAgentRef } from "../src/domain/read-ports.ts";
import { loadServiceEnv, buildRealAssemblyFor, sanitize } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";

const BRUNO: TenantAgentRef = {
  tenantId: "f49fd48a-4386-4009-95f3-26a5100b84f7",
  agentId: "aee7e916-31b1-431c-ba6f-f38178fd4899",
};

const STEPS = [
  ["Boa tarde"],
  ["Quero um SUV automatico ate 100 mil"],
  ["Gostei do segundo"],
  ["Me mande fotos dele"],
  ["Quero agendar uma visita"],
  ["Quinta-feira as 15h"],
  ["Quero falar com um vendedor"],
] as const;

const isBrain = (source: string | undefined) => /^brain_(?:final|retry)$/.test(source ?? "");

async function withDeadline<T>(work: Promise<T>, label: string, timeoutMs = 45_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`BRUNO_CANARY_${label}_TIMEOUT`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") {
    throw new Error("PEDRO_V3_REAL_EVAL_REQUIRED");
  }
  loadServiceEnv();
  const assembly = await withDeadline(buildRealAssemblyFor(BRUNO, new RealClock()), "ASSEMBLY");
  const stack = buildCentralStack(assembly);
  const turns = await runCentralConversation(assembly, stack, `wa:bruno-canary-${Date.now().toString(36)}`, STEPS, {
    maxLlmCalls: Number(process.env.BRUNO_CANARY_MAX_LLM_CALLS ?? "16"),
    singleAuthor: true,
    llmFirst: true,
    crmLeadId: "00000000-0000-4000-8000-000000000056",
    handoff: { enabled: true, available: true, precheck: { available: true, reason: "available" } as never },
  });

  const failures: string[] = [];
  if (turns.length !== STEPS.length) failures.push(`turn_count=${turns.length}`);
  for (const turn of turns) {
    if (turn.status !== "committed") failures.push(`T${turn.turnIndex}:status=${turn.status}`);
    if (!turn.response.trim()) failures.push(`T${turn.turnIndex}:empty_response`);
    if (turn.terminalSafe || turn.responseSource === "technical_fallback") failures.push(`T${turn.turnIndex}:fallback`);
    if (!turn.promptExactInTurn) failures.push(`T${turn.turnIndex}:portal_prompt_missing`);
  }
  const [opening, search, selection, photos, visit, schedule, human] = turns;
  if (!isBrain(opening?.responseSource)) failures.push("T1:not_llm_authored");
  if (!search?.toolsRequested.includes("stock_search")) failures.push("T2:stock_search_missing");
  if (!selection?.selectedVehicleKeyAfter) failures.push("T3:selection_missing");
  const photo = photos?.effects.find((effect) => effect.kind === "send_media");
  if (!photo || photo.vehicleKey !== selection?.selectedVehicleKeyAfter) failures.push("T4:photo_target_wrong_or_missing");
  if ((photo?.photoCount ?? 0) > 5) failures.push("T4:photo_cap_exceeded");
  if (visit?.primaryIntent !== "visit" || schedule?.primaryIntent !== "visit") failures.push("T5_T6:visit_not_understood");
  if (visit?.toolsRequested.some((tool) => tool !== "tenant_business_info") || schedule?.toolsRequested.some((tool) => tool !== "tenant_business_info")) failures.push("T5_T6:commercial_tool_on_visit");
  if (human?.primaryIntent !== "request_human") failures.push("T7:human_request_not_understood");
  if (!human?.effects.some((effect) => effect.kind === "handoff") || !human.effects.some((effect) => effect.kind === "notify_seller")) failures.push("T7:handoff_chain_missing");

  const lines = [
    "# Bruno/BNDV Pedro v3 canary",
    "",
    `Result: **${failures.length === 0 ? "PASS" : "FAIL"}**`,
    `Model calls: ${stack.brainTransport.count + stack.composeTransport.count}`,
    "",
    "| T | Lead | Response | Intent | Tools | Effects | Source |",
    "|---:|---|---|---|---|---|---|",
    ...turns.map((turn) => `| ${turn.turnIndex} | ${sanitize(turn.leadBlock).replace(/\|/g, "/")} | ${sanitize(turn.response).replace(/\|/g, "/")} | ${turn.primaryIntent ?? "-"} | ${turn.toolsRequested.join(", ") || "-"} | ${turn.effects.map((effect) => effect.kind).join(", ") || "-"} | ${turn.responseSource ?? "-"} |`),
    "",
    "## Failures",
    ...(failures.length ? failures.map((failure) => `- ${failure}`) : ["- None."]),
  ];
  const reportDir = join(process.cwd(), "eval", "reports");
  mkdirSync(reportDir, { recursive: true });
  const report = join(reportDir, `bruno-canary-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  writeFileSync(report, lines.join("\n"), "utf8");
  console.log(`REPORT ${report}`);
  console.log(`RESULT ${failures.length === 0 ? "PASS" : "FAIL"} calls=${stack.brainTransport.count + stack.composeTransport.count}`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
