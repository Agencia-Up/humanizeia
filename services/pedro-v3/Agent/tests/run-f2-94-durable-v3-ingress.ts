// ============================================================================
// F2.94 — ACK duravel do webhook antes do HTTP 200.
//
// Incidente real (WA, 2026-07-30): wa_inbox persistiu a mensagem, o webhook
// respondeu 200 e o EdgeRuntime encerrou a tarefa em waitUntil antes da chamada
// ao bridge. Resultado: zero v3_inbox, zero CRM, zero resposta.
//
// Contrato:
// 1) a primeira chamada ao bridge e aguardada e precisa provar ingested=true;
// 2) enriquecimento reutiliza o mesmo eventId e nunca cria segundo turno;
// 3) uma duplicata so pode enriquecer raw enquanto a linha estiver pending;
// 4) claimed/done/error ficam imutaveis;
// 5) midia sem texto possui contexto provisório honesto para o primeiro ingest.
// ============================================================================
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import {
  bridgePedroV3BeforeAck,
  buildPedroV3BridgeTurn,
  provisionalPedroV3MediaContext,
  type PedroV3BridgeCallResult,
  type PedroV3BridgeTurn,
} from "../../../../supabase/functions/_shared/pedro-v2/pedroV3Bridge.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { redact } from "../src/domain/effect-intent.ts";

let ok = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    ok += 1;
    console.log(`OK  ${name}`);
    return;
  }
  fail += 1;
  failures.push(`${name}${detail ? ` :: ${detail}` : ""}`);
  console.error(`FALHA ${name}${detail ? ` :: ${detail}` : ""}`);
}

function turn(overrides: Partial<PedroV3BridgeTurn> = {}): PedroV3BridgeTurn {
  return {
    tenantId: "tenant-1",
    agentId: "agent-1",
    instanceId: "instance-1",
    conversationId: "wa:conversation-1",
    turnId: "turn:event-1",
    eventId: "uazapi:event-1",
    workerId: "edge:test",
    to: "5512999999999",
    messageText: "Olá",
    receivedAt: "2026-07-30T16:52:50.000Z",
    leadId: null,
    leadNameHint: null,
    ...overrides,
  };
}

const accepted = (status = "accepted"): PedroV3BridgeCallResult => ({
  kind: "accepted",
  httpStatus: 200,
  serviceStatus: status,
});

console.log("\n=== F2.94 — durable V3 ingress before ACK ===\n");

// A. Media-only messages must be ingestible before transcription/vision I/O.
{
  const payload = {
    EventType: "messages",
    message: {
      key: { id: "audio-1", remoteJid: "5512999999999@s.whatsapp.net" },
      messageType: "audio",
      audioMessage: { url: "https://media.invalid/audio.ogg" },
      messageTimestamp: 1785420000,
    },
  };
  const provisional = provisionalPedroV3MediaContext(payload);
  check("[A1] áudio recebe contexto provisório sem I/O", provisional?.kind === "audio" && provisional.transcriptionAvailable === false);

  const built = await buildPedroV3BridgeTurn({
    payload,
    tenantId: "tenant-1",
    agentId: "agent-1",
    instanceId: "instance-1",
    separateConversationByInstance: true,
    build: "f294",
    mediaContext: provisional,
  });
  check("[A2] áudio sem legenda produz turno durável", built.ok && built.turn.messageText.includes("audio recebido sem transcricao"));
  check("[A3] turno provisório conserva a mídia como fato desconhecido", built.ok && built.turn.mediaContext?.confidence === 0);
}

// B. The provider ACK cannot outrun the first durable bridge call.
{
  const calls: PedroV3BridgeTurn[] = [];
  let enrichmentStarted = false;
  let releaseEnrichment!: () => void;
  const enrichmentGate = new Promise<void>((resolveGate) => { releaseEnrichment = resolveGate; });
  const initial = turn();
  const richer = turn({
    mediaContext: {
      kind: "audio",
      text: "Quero saber sobre a Meriva",
      summary: null,
      vehicleQuery: "Chevrolet Meriva",
      vehicleType: null,
      confidence: 1,
      transcriptionAvailable: true,
    },
  });

  const result = await bridgePedroV3BeforeAck({
    turn: initial,
    call: async (candidate) => {
      calls.push(candidate);
      return accepted();
    },
    enrich: async () => {
      enrichmentStarted = true;
      await enrichmentGate;
      return richer;
    },
  });

  check("[B1] retorno aceito só ocorre após a primeira chamada", result.kind === "accepted" && calls.length === 1);
  check("[B2] enriquecimento não bloqueia o ACK durável", enrichmentStarted && result.kind === "accepted" && result.enrichment != null);
  releaseEnrichment();
  const enrichedResult = result.kind === "accepted" && result.enrichment ? await result.enrichment : null;
  check("[B3] enriquecimento reutiliza o mesmo eventId", calls.length === 2 && calls[0]?.eventId === calls[1]?.eventId);
  check("[B4] segunda chamada leva o contexto rico", calls[1]?.mediaContext?.vehicleQuery === "Chevrolet Meriva");
  check("[B5] resultado do enriquecimento continua observável", enrichedResult?.kind === "accepted");
}

// C. No proof of durable ingestion means retry and absolutely no enrichment.
{
  let enrichmentStarted = false;
  const initialFailure: PedroV3BridgeCallResult = {
    kind: "uncertain",
    httpStatus: null,
    serviceStatus: "network_or_timeout",
  };
  const result = await bridgePedroV3BeforeAck({
    turn: turn(),
    call: async () => initialFailure,
    enrich: async () => {
      enrichmentStarted = true;
      return turn();
    },
  });
  check("[C1] falha incerta pede retry", result.kind === "retry" && result.initial.kind === "uncertain");
  check("[C2] enriquecimento não roda antes da prova durável", enrichmentStarted === false && result.enrichment === null);
}

// D. Enrichment failure cannot invalidate an already durable lead turn.
{
  const result = await bridgePedroV3BeforeAck({
    turn: turn(),
    call: async () => accepted(),
    enrich: async () => { throw new Error("vision offline"); },
  });
  const enrichment = result.kind === "accepted" && result.enrichment ? await result.enrichment : null;
  check("[D1] ingest inicial permanece aceito", result.kind === "accepted");
  check("[D2] falha posterior vira observação incerta", enrichment?.kind === "uncertain" && enrichment.serviceStatus === "enrichment_failed");
}

// E. Pending duplicate enriches one row; claimed duplicate cannot mutate it.
{
  const clock = new FakeClock("2026-07-30T16:52:50.000Z");
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const first = persistence.tryInsert({
    eventId: "same-event",
    conversationId: "same-conversation",
    raw: redact({ text: "[audio recebido sem transcricao disponivel]", mediaContext: { kind: "audio", confidence: 0 } }),
    receivedAt: clock.now(),
  });
  const duplicate = persistence.tryInsert({
    eventId: "same-event",
    conversationId: "same-conversation",
    raw: redact({
      text: "[audio recebida; contexto extraido: Quero uma Meriva]",
      mediaContext: { kind: "audio", confidence: 1, text: "Quero uma Meriva" },
    }),
    receivedAt: "2026-07-30T16:53:10.000Z",
  });
  const pending = persistence.get("same-event");
  check("[E1] duplicata continua no_op", first === true && duplicate === false && persistence.pendingCount("same-conversation") === 1);
  check("[E2] raw pending recebe o contexto rico", (pending?.raw.mediaContext as { confidence?: number } | undefined)?.confidence === 1);
  check("[E3] receivedAt original não muda", pending?.receivedAt === "2026-07-30T16:52:50.000Z");

  persistence.claimBurst("same-conversation", "2026-07-30T16:54:00.000Z", "worker-1", "turn-1");
  const afterClaimDuplicate = persistence.tryInsert({
    eventId: "same-event",
    conversationId: "same-conversation",
    raw: redact({ text: "NÃO PODE SUBSTITUIR", mediaContext: { kind: "audio", confidence: 0.2 } }),
    receivedAt: "2026-07-30T16:55:00.000Z",
  });
  const claimed = persistence.get("same-event");
  check("[E4] duplicata claimed continua no_op", afterClaimDuplicate === false && claimed?.status === "claimed");
  check("[E5] snapshot claimed permanece imutável", (claimed?.raw.mediaContext as { confidence?: number } | undefined)?.confidence === 1);

  persistence.tryInsert({
    eventId: "cross-conversation",
    conversationId: "conversation-a",
    raw: redact({ text: "original" }),
    receivedAt: clock.now(),
  });
  persistence.tryInsert({
    eventId: "cross-conversation",
    conversationId: "conversation-b",
    raw: redact({ text: "intruso" }),
    receivedAt: clock.now(),
  });
  check("[E6] colisão cross-conversation não altera o evento", persistence.get("cross-conversation")?.raw.text === "original");
}

// F. Static boundary: future refactors cannot put first ingest back in waitUntil.
{
  const repoRoot = resolve(import.meta.dirname, "../../../..");
  const webhook = readFileSync(join(repoRoot, "supabase/functions/pedro-webhook-v2/index.ts"), "utf8");
  const start = webhook.indexOf('pedroV3Pilot.mode === "active"');
  const end = webhook.indexOf("if (!_dryRun && typeof _waitUntil", start);
  const activeBranch = start >= 0 && end > start ? webhook.slice(start, end) : "";
  check("[F1] ramo active existe para auditoria", activeBranch.length > 500);
  check("[F2] primeira ingestão é awaited", activeBranch.includes("const durable = await bridgePedroV3BeforeAck"));
  check("[F3] ausência de prova retorna 503", activeBranch.includes('reason: "v3_ingest_not_proven"') && activeBranch.includes("}, 503)"));
  check("[F4] primeiro bridge não está encapsulado em waitUntil", !activeBranch.includes("_waitUntil((async"));
  check(
    "[F5] HTTP 200 vem depois da validação durable",
    activeBranch.indexOf('if (durable.kind !== "accepted")') < activeBranch.indexOf('routed: "pedro_v3_durable"'),
  );
  const transpiled = ts.transpileModule(webhook, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "supabase/functions/pedro-webhook-v2/index.ts",
    reportDiagnostics: true,
  });
  const syntaxErrors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  check("[F6] arquivo Edge permanece sintaticamente válido", syntaxErrors.length === 0, JSON.stringify(syntaxErrors));
}

// G. SQL contract: merge only pending, never create a second event.
{
  const repoRoot = resolve(import.meta.dirname, "../../../..");
  const migration = readFileSync(
    join(repoRoot, "supabase/migrations/20260730190000_v3_pending_inbox_enrichment.sql"),
    "utf8",
  );
  check("[G1] migração mantém PK/eventId como dedupe", migration.includes("on conflict (event_id) do nothing"));
  check("[G2] enriquecimento é restrito a pending", /inbox\.status\s*=\s*'pending'/.test(migration));
  check("[G3] identidade tenant+conversation é conferida", migration.includes("inbox.tenant_id = p_tenant_id") && migration.includes("inbox.conversation_id = p_conversation_id"));
  check("[G4] duplicata continua retornando false", /update public\.v3_inbox[\s\S]+return false;/m.test(migration));
  check("[G5] received_at não é reescrito no UPDATE", !/set[\s\S]{0,200}received_at\s*=/.test(migration));
}

console.log(`\nF2.94: ${ok} OK / ${fail} FALHA\n`);
if (fail > 0) {
  for (const item of failures) console.error(` - ${item}`);
  process.exit(1);
}
