import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { CrmWriteEffectDispatcher } from "../src/adapters/effects/crm-write-dispatcher.ts";
import { SupabaseCrmLeadStore } from "../src/adapters/effects/supabase-crm-lead-store.ts";
import { SupabaseTransferStore } from "../src/adapters/effects/supabase-transfer-store.ts";
import { HandoffEffectDispatcher, NotifySellerEffectDispatcher } from "../src/adapters/effects/transfer-dispatchers.ts";
import { UazapiWhatsAppSender } from "../src/adapters/effects/uazapi-whatsapp-sender.ts";
import { V2WhatsAppInstanceCredentialProvider, V2WhatsAppInstanceSource } from "../src/adapters/effects/v2-whatsapp-instance-source.ts";
import { SupabaseReadOnlyDatabase } from "../src/adapters/read/supabase-read-database.ts";
import { V2DatabaseReadGateway } from "../src/adapters/read/supabase-v2-read-adapter.ts";
import { V2PlaintextApiKeyReader } from "../src/adapters/read/v2-api-key-reader.ts";
import { V2TenantConfigSource } from "../src/adapters/read/tenant-config-source.ts";
import type { OutboxRecord } from "../src/domain/decision.ts";
import type { AdContext } from "../src/domain/conversation-state.ts";
import { PEDRO_V3_PILOT_AGENT_ID, PEDRO_V3_PILOT_TENANT_ID } from "../src/domain/pilot-scope.ts";
import type { TenantAgentRef } from "../src/domain/read-ports.ts";
import { FetchUazapiHttpTransport } from "../src/runtime/fetch-transports.ts";
import { RealClock } from "../src/runtime/real-clock.ts";
import {
  adFromMetadata,
  baseViolations,
  CARVALHO_BNDV,
  runScenario,
  type Scenario,
  type TurnLog,
} from "./run-cross-agent-ad-audit.ts";
import { loadServiceEnv, sanitize } from "./real-harness.ts";

const RUNTIME: TenantAgentRef = { tenantId: PEDRO_V3_PILOT_TENANT_ID, agentId: PEDRO_V3_PILOT_AGENT_ID };
const TIME_ZONE_OFFSET = "-03:00";
const TEST_PHONES = ["5511999901001", "5511999901002", "5511999901003"] as const;

type HistoryRow = {
  id: string;
  remote_jid: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ReplayCase = {
  alias: string;
  ad: AdContext;
  originalSteps: string[][];
  continuation: string[][];
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`ENV_${name}_MISSING`);
  return value;
}

function hostOf(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("URL_INVALID");
  return parsed.hostname.toLowerCase();
}

function aliasFor(remoteJid: string): string {
  return `contato-${createHash("sha256").update(remoteJid).digest("hex").slice(0, 8)}`;
}

function userBursts(rows: HistoryRow[]): string[][] {
  const bursts: string[][] = [];
  let current: string[] = [];
  for (const row of rows) {
    if (row.role === "user") {
      const text = row.content.replace(/\s+/g, " ").trim();
      if (text) current.push(text);
      continue;
    }
    if (current.length > 0) bursts.push(current);
    current = [];
  }
  if (current.length > 0) bursts.push(current);
  return bursts;
}

async function loadTodayCases(): Promise<ReplayCase[]> {
  const day = process.env.V2_AUDIT_DAY?.trim() || new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const start = new Date(`${day}T00:00:00${TIME_ZONE_OFFSET}`).toISOString();
  const next = new Date(`${day}T00:00:00${TIME_ZONE_OFFSET}`);
  next.setUTCDate(next.getUTCDate() + 1);
  const params = new URLSearchParams({
    select: "id,remote_jid,role,content,metadata,created_at",
    agent_id: `eq.${CARVALHO_BNDV.agentId}`,
    created_at: `gte.${start}`,
    order: "created_at.asc",
    limit: "5000",
  });
  params.append("created_at", `lt.${next.toISOString()}`);
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${requiredEnv("SUPABASE_URL")}/rest/v1/wa_chat_history?${params}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`HISTORY_HTTP_${response.status}`);
  const rows = await response.json() as HistoryRow[];
  const grouped = new Map<string, HistoryRow[]>();
  for (const row of rows) grouped.set(row.remote_jid, [...(grouped.get(row.remote_jid) ?? []), row]);
  const ranked = [...grouped.entries()].map(([jid, turns]) => {
    const ad = turns.map((turn) => adFromMetadata(turn.metadata ?? {})).find(Boolean) ?? null;
    return { jid, turns, ad, leadCount: turns.filter((turn) => turn.role === "user").length };
  }).filter((item): item is { jid: string; turns: HistoryRow[]; ad: AdContext; leadCount: number } => !!item.ad && item.leadCount >= 2)
    .sort((a, b) => b.leadCount - a.leadCount)
    .slice(0, 3);
  if (ranked.length < 3) throw new Error(`TODAY_CONVERSATIONS_INSUFFICIENT:${ranked.length}`);

  const continuations: string[][][] = [
    [["quero ver outros carros ate 70 mil"], ["gostei do primeiro"], ["quero agendar uma visita"], ["quinta-feira"], ["as 15h"], ["CPF 529.982.247-25", "data de nascimento 01/10/1997"], ["quero falar com um vendedor"]],
    [["gostei do segundo"], ["quais as condicoes?"], ["nao tenho carro para troca"], ["tenho 10 mil de entrada"], ["parcela ate 2500"], ["quero visitar no sabado de manha"], ["CPF 529.982.247-25", "nascimento 01/10/1997"], ["me transfere para um vendedor"]],
    [["a Toro 2024 tem 35 mil km"], ["tenho 15 mil de entrada"], ["parcela ate 3000"], ["quero agendar visita"], ["segunda-feira"], ["as 14h"], ["CPF 529.982.247-25", "data de nascimento 01/10/1997"], ["quero falar com atendente humano"]],
  ];
  return ranked.map((item, index) => ({
    alias: aliasFor(item.jid),
    ad: item.ad,
    originalSteps: userBursts(item.turns),
    continuation: continuations[index],
  }));
}

function hasEffect(turn: TurnLog | undefined, kind: string): boolean {
  return !!turn?.effects.some((effect) => effect.kind === kind);
}

function assess(turns: TurnLog[], originalCount: number): string[] {
  const failures = baseViolations(turns);
  if (!turns.some((turn) => turn.tools.some((tool) => tool.tool === "stock_search" && (tool.itemCount ?? 0) > 0))) {
    failures.push("nenhuma consulta BNDV retornou veiculo");
  }
  for (const turn of turns) {
    if (!/^brain_(?:final|retry)$|^deterministic_(?:photo|institutional)$/.test(turn.responseSource ?? "")) {
      failures.push(`T${turn.turn}: autoria invalida (${turn.responseSource ?? "-"})`);
    }
    if (turn.terminalSafe || turn.responseSource === "technical_fallback") failures.push(`T${turn.turn}: degradacao/fallback`);
  }
  const synthetic = turns.slice(originalCount);
  const multiJeep = turns.find((turn) => /renegade/i.test(turn.lead) && /compass/i.test(turn.lead) && /foto/i.test(turn.lead));
  if (multiJeep) {
    const answeredBothModels = /renegade/i.test(multiJeep.response) && /compass/i.test(multiJeep.response);
    const searchedStock = multiJeep.tools.some((tool) => tool.tool === "stock_search");
    if (!searchedStock) failures.push(`T${multiJeep.turn}: pedido Renegade/Compass nao consultou estoque`);
    if (!answeredBothModels) failures.push(`T${multiJeep.turn}: resposta ignorou Renegade ou Compass`);
  }
  const visit = synthetic.find((turn) => turn.primaryIntent === "visit");
  if (!visit) failures.push("continuacao nao registrou visita");
  const pii = synthetic.find((turn) => turn.slotsDelta.some((slot) => slot.slot === "cpf" || slot.slot === "birthDate"));
  if (!pii) failures.push("continuacao nao registrou CPF/data como referencias");
  const last = turns.at(-1);
  if (last?.primaryIntent !== "request_human" || !hasEffect(last, "handoff") || !hasEffect(last, "notify_seller")) {
    failures.push("ultimo turno nao planejou handoff + notify_seller");
  }
  return [...new Set(failures)];
}

function maskLead(text: string): string {
  return sanitize(text)
    .replace(/\b529[.\s-]*982[.\s-]*247[.\s-]*25\b/g, "[CPF_TESTE]")
    .replace(/\b01\/10\/1997\b/g, "[DATA_TESTE]");
}

function reportTable(turns: TurnLog[], originalCount: number): string {
  const header = "| T | origem | lead | resposta Pedro v3 | intent | tools | efeitos | slots | autoria | feedback |";
  const sep = "|---:|---|---|---|---|---|---|---|---|---|";
  const rows = turns.map((turn, index) => {
    const source = index < originalCount ? "real v2" : "continuacao de teste";
    const tools = turn.tools.map((tool) => {
      const count = tool.itemCount == null ? "" : `(${tool.itemCount})`;
      const input = Object.keys(tool.input).length > 0 ? ` ${JSON.stringify(tool.input)}` : "";
      return `${tool.tool}${count}${input}`;
    }).join(", ") || "-";
    const effects = turn.effects.map((effect) => effect.kind).join(", ") || "-";
    const slots = turn.slotsDelta.map((slot) => `${slot.slot}=${slot.to}`).join("<br>") || "-";
    const feedback = [...turn.policyFeedback, ...turn.controlFeedback]
      .map((item) => sanitize(item).slice(0, 160).replace(/\|/g, "\\|"))
      .join("<br>") || "-";
    return `| ${turn.turn} | ${source} | ${maskLead(turn.lead).replace(/\|/g, "\\|")} | ${maskLead(turn.response).replace(/\|/g, "\\|")} | ${turn.primaryIntent ?? "-"} | ${tools} | ${effects} | ${slots.replace(/\|/g, "\\|")} | ${turn.responseSource ?? "-"} | ${feedback} |`;
  });
  return [header, sep, ...rows].join("\n");
}

async function makeRealDispatchers(conversationId: string) {
  const url = requiredEnv("SUPABASE_URL");
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const allowedHosts = [hostOf(url)];
  const db = SupabaseReadOnlyDatabase.create({ url, apiKey: key, allowedHosts, timeoutMs: 15_000, maxResponseBytes: 4 * 1024 * 1024 });
  const gateway = new V2DatabaseReadGateway(db);
  const configResult = await new V2TenantConfigSource(gateway).load(RUNTIME);
  if (!configResult.ok || !configResult.config.instanceId) throw new Error("RUNTIME_INSTANCE_MISSING");
  const instanceSource = new V2WhatsAppInstanceSource(db);
  const instance = await instanceSource.loadOwnedInstance(RUNTIME, configResult.config.instanceId);
  if (!instance || instance.provider !== "uazapi") throw new Error("UAZAPI_INSTANCE_MISSING");
  const credentialProvider = new V2WhatsAppInstanceCredentialProvider(db, new V2PlaintextApiKeyReader());
  const sender = new UazapiWhatsAppSender({
    baseUrl: instance.apiUrl,
    allowedHosts: [hostOf(instance.apiUrl)],
    instanceName: instance.instanceName,
    tokenRef: instance.tokenRef,
  }, credentialProvider, new FetchUazapiHttpTransport());
  const crm = new SupabaseCrmLeadStore({ url, serviceRoleKey: key, allowedHosts });
  const transfer = new SupabaseTransferStore({ url, serviceRoleKey: key, allowedHosts });
  const clock = new RealClock();
  return {
    crm,
    crmDispatcher: new CrmWriteEffectDispatcher({ ref: RUNTIME, clock, store: crm }),
    handoffDispatcher: new HandoffEffectDispatcher({ ref: RUNTIME, clock, store: transfer }),
    notifyDispatcher: new NotifySellerEffectDispatcher({ ref: RUNTIME, clock, store: transfer, sender }),
    conversationId,
  };
}

async function dispatchControlledTransfer(turns: TurnLog[], scenarioIndex: number): Promise<string> {
  const records = turns.flatMap((turn) => turn.effectRecords);
  const handoff = [...records].reverse().find((record) => record.kind === "handoff");
  const notify = [...records].reverse().find((record) => record.kind === "notify_seller");
  if (!handoff || !notify) throw new Error("HANDOFF_RECORDS_MISSING");
  const runtime = await makeRealDispatchers(handoff.conversationId);
  for (const crmRecord of records.filter((record) => record.kind === "crm_write")) {
    const result = await runtime.crmDispatcher.dispatch(crmRecord);
    if (result.status !== "succeeded") throw new Error(`CRM_DISPATCH_${result.status}`);
  }
  const handoffPayload = handoff.payload as Record<string, unknown>;
  const testHandoff = {
    ...handoff,
    payload: {
      ...handoffPayload,
      briefing: `[TESTE CONTROLADO ${scenarioIndex + 1}/3 - replay Pedro v2 no Pedro v3]\n\n${String(handoffPayload.briefing ?? "")}`,
    },
  } as OutboxRecord;
  const handoffResult = await runtime.handoffDispatcher.dispatch(testHandoff);
  if (handoffResult.status !== "succeeded") throw new Error(`HANDOFF_DISPATCH_${handoffResult.status}`);
  const notifyResult = await runtime.notifyDispatcher.dispatch(notify);
  if (notifyResult.status !== "succeeded") throw new Error(`NOTIFY_DISPATCH_${notifyResult.status}`);
  return "handoff entregue e vendedor notificado";
}

async function main(): Promise<void> {
  loadServiceEnv();
  const started = new Date().toISOString();
  const discoveredCases = await loadTodayCases();
  const only = Number(process.env.V2_TODAY_ONLY ?? 0);
  const cases = Number.isInteger(only) && only >= 1 && only <= discoveredCases.length
    ? [discoveredCases[only - 1]]
    : discoveredCases;
  const report: string[] = [
    "# Auditoria - 3 conversas reais de hoje do Pedro v2 no Pedro v3",
    "",
    `Execucao: ${started}`,
    "",
    "Origem: mensagens reais de leads atendidos hoje pelo Carvalho/Pedro v2.",
    "Runtime: prompt, cerebro, CRM e vendedor da conta Douglas/Pedro v3.",
    "Estoque e fotos: BNDV da conta de origem.",
    "A continuacao apos a conversa original e explicitamente marcada e existe apenas para provar visita, PII segura e transferencia.",
    "",
  ];
  let totalFailures = 0;
  const completed: Array<{ index: number; item: ReplayCase; turns: TurnLog[]; failures: string[] }> = [];
  for (let index = 0; index < cases.length; index++) {
    const item = cases[index];
    const sourceIndex = Number.isInteger(only) && only >= 1 ? only - 1 : index;
    const phone = TEST_PHONES[sourceIndex];
    const dispatchers = await makeRealDispatchers(`replay-${index + 1}`);
    const identity = await dispatchers.crm.ensureOwnedLead(RUNTIME, phone);
    if (!identity.ok) throw new Error(`CRM_IDENTITY_${index + 1}_${identity.reason}`);
    const scenario: Scenario = {
      id: `v2-today-${sourceIndex + 1}`,
      label: `Conversa ${sourceIndex + 1} (${item.alias})`,
      sourceRef: CARVALHO_BNDV,
      stockLabel: "BNDV/Carvalho",
      ad: item.ad,
      expectedModel: null,
      switchTo: "",
      steps: [...item.originalSteps, ...item.continuation],
      expect: () => [],
    };
    process.stdout.write(`REPLAY ${sourceIndex + 1}/3 ${item.alias}\n`);
    const turns = await runScenario(scenario, { leadId: identity.leadId, leadPhone: phone, conversationIdPrefix: "v2today" });
    const failures = assess(turns, item.originalSteps.length);
    totalFailures += failures.length;
    completed.push({ index: sourceIndex, item, turns, failures });
    const transferStatus = process.env.V2_TODAY_REAL_TRANSFER === "1"
      ? "aguardando aprovacao conjunta das 3 conversas"
      : "efeitos reais desativados neste run";
    report.push(`## Conversa ${sourceIndex + 1} - ${item.alias}`, "", failures.length === 0 ? "Resultado: **PASS**" : `Resultado: **FAIL (${failures.length})**`, "");
    for (const failure of failures) report.push(`- ${failure}`);
    if (failures.length) report.push("");
    report.push(`Transferencia real: **${transferStatus}**`, "", reportTable(turns, item.originalSteps.length), "");
  }
  if (totalFailures === 0 && process.env.V2_TODAY_REAL_TRANSFER === "1") {
    report.push("## Transferencias controladas", "");
    for (const result of completed) {
      const status = await dispatchControlledTransfer(result.turns, result.index);
      report.push(`- Conversa ${result.index + 1}: ${status}`);
    }
    report.push("");
  } else if (process.env.V2_TODAY_REAL_TRANSFER === "1") {
    report.push("## Transferencias controladas", "", "Nenhuma transferencia foi executada porque ao menos uma conversa falhou.", "");
  }
  report.push(`## Veredito`, "", `Falhas totais: **${totalFailures}**`, "");
  const output = resolve("eval/reports", `v2-today-on-v3-${started.replace(/[:.]/g, "-")}.md`);
  mkdirSync(resolve("eval/reports"), { recursive: true });
  writeFileSync(output, report.join("\n"), "utf8");
  process.stdout.write(`REPORT ${output}\nRESULT ${totalFailures === 0 ? "PASS" : "FAIL"} failures=${totalFailures}\n`);
  if (totalFailures > 0) process.exitCode = 1;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
