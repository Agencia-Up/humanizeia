// Low-cost, no-side-effect Bruno/BNDV canary.
// Uses real CTWA payloads stored for Carvalho, the current portal prompt, BNDV,
// and the configured model. CRM/WhatsApp/seller dispatch remain in memory.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { TenantAgentRef } from "../src/domain/read-ports.ts";
import { RealClock } from "../src/runtime/real-clock.ts";
import { buildRealAssemblyFor, loadServiceEnv, sanitize } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";

const BRUNO: TenantAgentRef = {
  tenantId: "f49fd48a-4386-4009-95f3-26a5100b84f7",
  agentId: "aee7e916-31b1-431c-ba6f-f38178fd4899",
};

type AdContext = {
  adId: string | null;
  source: string | null;
  sourceUrl: string | null;
  title: string | null;
  body: string | null;
  greeting: string | null;
  imageUrls: string[];
  capturedAtTurn: number;
};

type Scenario = {
  readonly id: string;
  readonly adNeedle: string;
  readonly expectedModel: RegExp | null;
  readonly steps: readonly (readonly string[])[];
  readonly media?: Readonly<Record<number, unknown>>;
};

const SCENARIOS: readonly Scenario[] = [
  {
    id: "hb20x-ad-to-handoff",
    adNeedle: "HB20X Premium 1.6 2019",
    expectedModel: /hb\s*20\s*x/i,
    steps: [
      ["Ola, vim pelo anuncio. Ele ainda esta disponivel?"],
      ["Pode me mandar fotos dele?"],
      ["Tenho 15 mil de entrada e quero financiar o restante"],
      ["Quero visitar na segunda as 15h"],
      ["Quero falar com um vendedor"],
    ],
  },
  {
    id: "fastback-ad-pivot",
    adNeedle: "Fastback Audace T200 1.0 2025",
    expectedModel: /fastback/i,
    steps: [
      ["Boa tarde, queria saber mais desse carro"],
      ["Ele e hibrido?"],
      ["Na verdade quero um sedan automatico ate 120 mil"],
      ["Quero agendar uma visita sabado de manha"],
      ["Me transfere para um vendedor"],
    ],
  },
  {
    id: "generic-ad-audio-image",
    adNeedle: "nossos carros revisados e com garantia",
    expectedModel: null,
    steps: [
      // This is the exact text shape the production bridge gives the brain
      // after the upstream media resolver transcribes/describes the inbound.
      ["[audio recebido; contexto extraido: Procuro um SUV automatico ate 100 mil]"],
      ["[imagem recebida; contexto extraido: imagem de um SUV branco em anuncio]"],
      ["Gostei do segundo e quero as fotos dele"],
      ["Quero falar com atendente humano"],
    ],
    media: {
      1: { kind: "audio", text: "Procuro um SUV automatico ate 100 mil", summary: "lead procura SUV automatico ate 100 mil", vehicleQuery: null, vehicleType: "suv", confidence: 0.95, transcriptionAvailable: true },
      2: { kind: "image", text: "imagem de um SUV branco em anuncio", summary: "imagem recebida de um SUV branco", vehicleQuery: null, vehicleType: "suv", confidence: 0.7, transcriptionAvailable: null },
    },
  },
];

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function adFromMetadata(metadata: Record<string, unknown>): AdContext | null {
  const raw = (metadata.ctwa_ad ?? metadata.ad_context ?? metadata.externalAdReply) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;
  const media = Array.isArray(metadata.media) ? metadata.media : [];
  const imageUrls = media
    .map((item) => text((item as Record<string, unknown>)?.file ?? (item as Record<string, unknown>)?.url))
    .filter((url): url is string => !!url && !url.startsWith("data:"))
    .slice(0, 3);
  return {
    adId: text(raw.sourceId ?? raw.sourceID ?? raw.adId ?? raw.ad_id),
    source: text(raw.sourceApp ?? raw.source ?? raw.conversionSource),
    sourceUrl: text(raw.sourceUrl ?? raw.sourceURL ?? raw.url),
    title: text(raw.title),
    body: text(raw.body ?? raw.description),
    greeting: text(raw.greetingMessageBody ?? raw.greeting),
    imageUrls,
    capturedAtTurn: 0,
  };
}

function norm(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function loadAd(needle: string): Promise<AdContext> {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("SUPABASE_EVAL_ENV_MISSING");
  const query = new URLSearchParams({
    select: "metadata",
    agent_id: `eq.${BRUNO.agentId}`,
    metadata: "not.is.null",
    order: "created_at.desc",
    limit: "1200",
  });
  const response = await fetch(`${url}/rest/v1/wa_chat_history?${query}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`AD_QUERY_${response.status}`);
  const rows = await response.json() as Array<{ metadata?: Record<string, unknown> }>;
  const expected = norm(needle);
  for (const row of rows) {
    const ad = adFromMetadata(row.metadata ?? {});
    if (!ad) continue;
    const combined = [ad.greeting, ad.title, ad.body, ad.sourceUrl].filter(Boolean).join(" ");
    if (norm(combined).includes(expected)) return ad;
  }
  throw new Error(`REAL_AD_NOT_FOUND:${needle}`);
}

const isBrain = (source: string | undefined) => /^brain_(?:final|retry)$/.test(source ?? "");

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") throw new Error("PEDRO_V3_REAL_EVAL_REQUIRED");
  loadServiceEnv();
  const assembly = await buildRealAssemblyFor(BRUNO, new RealClock());
  const maxLlmCalls = Number(process.env.BRUNO_AD_MEDIA_MAX_LLM_CALLS ?? "16");
  if (!Number.isInteger(maxLlmCalls) || maxLlmCalls < 1 || maxLlmCalls > 24) {
    throw new Error("BRUNO_AD_MEDIA_MAX_LLM_CALLS_INVALID");
  }
  const report: string[] = [
    "# Bruno/BNDV - anuncios reais + midia inbound",
    "",
    `Provider/model: ${assembly.aiProvider.provider}/${assembly.aiProvider.model}`,
    `Limite de chamadas LLM por cenario: ${maxLlmCalls}`,
    "Efeitos externos: OFF (CRM, WhatsApp e vendedor em memoria).",
    "",
  ];
  let failures = 0;
  let totalCalls = 0;

  const requestedScenario = process.env.BRUNO_AD_MEDIA_SCENARIO?.trim();
  const scenarios = requestedScenario
    ? SCENARIOS.filter((scenario) => scenario.id === requestedScenario)
    : SCENARIOS;
  if (scenarios.length === 0) throw new Error(`UNKNOWN_BRUNO_AD_MEDIA_SCENARIO:${requestedScenario}`);

  for (const scenario of scenarios) {
    console.log(`CANARY loading ${scenario.id}`);
    const ad = await loadAd(scenario.adNeedle);
    console.log(`CANARY running ${scenario.id}`);
    const stack = buildCentralStack(assembly);
    const turns = await runCentralConversation(assembly, stack, `wa:bruno-ad-media-${scenario.id}-${Date.now().toString(36)}`, scenario.steps, {
      maxLlmCalls,
      singleAuthor: true,
      llmFirst: true,
      crmLeadId: "00000000-0000-4000-8000-000000000057",
      handoff: { enabled: true, available: true, precheck: { available: true, reason: "available" } as never },
      firstTurnAdContext: ad,
      mediaContextByTurn: scenario.media,
    });
    totalCalls += stack.brainTransport.count + stack.composeTransport.count;
    const errors: string[] = [];
    if (turns.length !== scenario.steps.length) errors.push(`turn_count=${turns.length}`);
    if (turns.some((turn) => turn.status !== "committed" || turn.terminalSafe || !isBrain(turn.responseSource))) errors.push("fallback_or_non_llm_turn");
    if (turns.some((turn) => !turn.promptExactInTurn)) errors.push("portal_prompt_missing");
    if (scenario.expectedModel && !scenario.expectedModel.test(turns[0]?.response ?? "")) errors.push("ad_vehicle_not_mentioned_on_opening");
    if (scenario.id === "hb20x-ad-to-handoff") {
      if (!turns[1]?.effects.some((effect) => effect.kind === "send_media")) errors.push("hb20x_photos_missing");
      if (turns[3]?.primaryIntent !== "visit") errors.push("visit_not_understood");
    }
    if (scenario.id === "fastback-ad-pivot") {
      if (!turns[2]?.toolsRequested.includes("stock_search")) errors.push("pivot_stock_search_missing");
      if (/fastback/i.test(turns[2]?.response ?? "") && !/sedan/i.test(turns[2]?.response ?? "")) errors.push("pivot_stuck_on_ad");
    }
    if (scenario.id === "generic-ad-audio-image") {
      if (!turns[0]?.toolsRequested.includes("stock_search")) errors.push("audio_transcript_not_used_for_search");
      if (!turns[2]?.effects.some((effect) => effect.kind === "send_media")) errors.push("media_followup_photo_missing");
    }
    const final = turns.at(-1);
    if (final?.primaryIntent !== "request_human" || !final.effects.some((effect) => effect.kind === "handoff") || !final.effects.some((effect) => effect.kind === "notify_seller")) errors.push("handoff_chain_missing");
    failures += errors.length;
    report.push(`## ${scenario.id}`, "", `Resultado: **${errors.length ? "FAIL" : "PASS"}**`, "");
    report.push(`Anuncio real injetado: ${sanitize([ad.greeting, ad.title, ad.body].filter(Boolean).join(" | ")).slice(0, 420) || "(sem texto)"}`, "");
    if (errors.length) report.push(...errors.map((error) => `- ${error}`), "");
    report.push("| T | lead | resposta | intent | tools | effects | source |", "|---:|---|---|---|---|---|---|");
    for (const turn of turns) {
      report.push(`| ${turn.turnIndex} | ${sanitize(turn.leadBlock).replace(/\|/g, "/")} | ${sanitize(turn.response).replace(/\|/g, "/")} | ${turn.primaryIntent ?? "-"} | ${turn.toolsRequested.join(", ") || "-"} | ${turn.effects.map((effect) => effect.kind).join(", ") || "-"} | ${turn.responseSource ?? "-"} |`);
    }
    if (errors.length) {
      report.push("", "### Diagnostico de validacao");
      for (const turn of turns) {
        const feedback = turn.policyFeedback?.join(" / ") ?? "";
        const observations = turn.observations.map((item) => `${item.tool}:${item.ok ? "ok" : item.code ?? "erro"}`).join(", ");
        if (feedback || observations || turn.reasonCode) {
          report.push(`- T${turn.turnIndex} reason=${turn.reasonCode ?? "-"}; feedback=${sanitize(feedback) || "-"}; tools=${observations || "-"}`);
        }
      }
    }
    report.push("");
  }
  report.push(`Calls: ${totalCalls}`, `Failures: ${failures}`);
  const reportDir = join(process.cwd(), "eval", "reports");
  mkdirSync(reportDir, { recursive: true });
  const output = join(reportDir, `bruno-real-ad-media-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  writeFileSync(output, report.join("\n"), "utf8");
  console.log(`REPORT ${output}`);
  console.log(`RESULT ${failures === 0 ? "PASS" : "FAIL"} calls=${totalCalls} failures=${failures}`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
