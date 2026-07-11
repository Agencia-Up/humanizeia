// ============================================================================
// eval/central-assertions.ts — ASSERÇÕES DETERMINÍSTICAS do gate R13 Inc2/G (agente central).
// Detectores próprios (regex sobre a fala do lead), independentes do engine. Cada `critical` reprova o gate.
// (o judge LLM é só diagnóstico — as assertivas aqui são a autoridade.)
// ============================================================================
export type CentralTurnCapture = {
  turnIndex: number; turnId: string; leadBlock: string; response: string; status: string;
  reasonCode?: string; terminalSafe: boolean; brainSteps: number; llmCallsInTurn: number; promptExactInTurn: boolean;
  responseSource?: string;                 // diagnóstico: brain_final|brain_retry|deterministic_*|technical_fallback
  policyFeedback?: readonly string[];      // diagnóstico: feedbacks de deny devolvidos ao cérebro (revela por que degradou)
  primaryIntent?: string;                  // T6 fonte única: semântica do turno (do cérebro OU fallback validado)
  targetResolutionSource?: string | null;  // T6: como o alvo do turno foi resolvido (turn_photo_fact/turn_ordinal/...)
  resolvedVehicleKey?: string | null;      // T6: veículo do send_media do turno (alvo efetivo)
  understandingFromBrain?: boolean;        // T6: o cérebro emitiu understanding? (senão caiu no fallback)
  toolsRequested: string[];
  observations: { tool: string; ok: boolean }[];
  effects: { kind: string; vehicleKey?: string; photoCount?: number; status: string }[];
  handoffBriefing?: string | null;         // MISSÃO PII: briefing integral do effect handoff do turno (relatório)
  handoffReason?: string | null;           // MISSÃO PII: reason tipado do handoff planejado no turno
  slotsDelta: { slot: string; from: string; to: string }[];
  wmBeforeLastPhotoLabel: string | null;
  wmAfterLastPhotoLabel: string | null;
  possuiTrocaBefore: string; possuiTrocaAfter: string;
  selectedVehicleKeyAfter?: string | null;
};

export type Severity = "critical" | "warn";
export type Violation = { code: string; severity: Severity; turnIndex: number; detail: string };
export type CentralAssertionReport = { violations: Violation[]; criticalCount: number; warnCount: number };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const COMMERCIAL_TOOLS = new Set(["stock_search", "vehicle_details", "vehicle_photos_resolve", "crm_read"]);

// pedido de foto AGORA (imperativo/desejo), NÃO uma pergunta sobre foto passada.
function isPhotoRequest(lead: string): boolean {
  const n = norm(lead);
  if (isPhotoMemoryQuestion(lead)) return false;
  return /\b(manda|mandar|envia|enviar|mostra|mostrar|me\s+ve|quero\s+ver|ver)\b[^?]*\bfotos?\b|\bfotos?\s+d(o|a|e|esse|essa|ele)\b/.test(n);
}
// pergunta SOBRE uma foto/carro já pedido (memória) — não é pedido novo.
function isPhotoMemoryQuestion(lead: string): boolean {
  const n = norm(lead);
  return /\b(qual|que)\b[^?]*\b(foto|carro|ve[ií]culo)\b[^?]*\b(pedi|pediu|mandei|mostrei|recebi|foto)/.test(n)
    || /\bqual\s+carro\b[^?]*\bfoto/.test(n)
    || (/\?/.test(lead) && /\bfoto/.test(n) && /\bpedi\b|\bmandei\b|\bqual\b/.test(n));
}
function isStoreQuestion(lead: string): boolean {
  const n = norm(lead);
  return /\bloja\b|\bendereco\b|\bendereço\b|\bonde\s+(fica|voces?|vcs?|e|esta)|fica(m)?\b.*\bonde|\bhorario\b|\bque\s+horas\b|\bunidade\b|\bfuncionament/.test(n);
}
function isGreetingOnly(lead: string): boolean {
  const n = norm(lead).trim();
  return /^(oi|ola|opa|bom dia|boa tarde|boa noite|e ai|eai|tudo bem|tudo bom|blz|beleza)[\s!.,?]*$/.test(n);
}
// tokens de modelo/marca do label lembrado (ex.: "Nissan Kicks 2018" -> ["nissan","kicks"]).
function labelTokens(label: string): string[] {
  return norm(label).split(/\s+/).filter((t) => t.length >= 3 && !/^(19|20)\d{2}$/.test(t));
}

export function runCentralAssertions(turns: readonly CentralTurnCapture[]): CentralAssertionReport {
  const V: Violation[] = [];
  const add = (severity: Severity, code: string, turnIndex: number, detail: string) => V.push({ code, severity, turnIndex, detail });
  let introSeen = false;

  for (const t of turns) {
    const lead = t.leadBlock;
    const resp = t.response ?? "";
    const executed = t.observations.filter((o) => !(o.ok === false)).map((o) => o.tool)
      .concat(t.observations.filter((o) => o.ok === false).map((o) => o.tool)); // executed (ok) + ran-but-not-configured; FORBIDDEN nunca vira observação executada aqui
    const commercialExecuted = t.observations.map((o) => o.tool).filter((tool) => COMMERCIAL_TOOLS.has(tool));
    const sentMedia = t.effects.some((e) => e.kind === "send_media");

    // ── GATE (critical) ──
    if (t.status !== "committed") add("critical", "TURN_NOT_COMMITTED", t.turnIndex, `status=${t.status}`);
    if (!t.promptExactInTurn) add("critical", "PROMPT_MISSING_IN_LLM_CALL", t.turnIndex, "prompt do portal ausente em alguma chamada LLM do turno");
    if (t.terminalSafe) add("critical", "TERMINAL_SAFE_TO_LEAD", t.turnIndex, `terminal_safe reason=${t.reasonCode}`);
    if (resp.includes("�")) add("critical", "UFFFD_IN_RESPONSE", t.turnIndex, "caractere de substituição U+FFFD na resposta");
    if ((resp.match(/\?/g) ?? []).length > 1) add("critical", "MULTI_QUESTION", t.turnIndex, `mais de uma pergunta na resposta: "${resp.slice(0, 60)}"`);
    if ((t.reasonCode ?? "").includes("ask_which")) add("critical", "PHOTO_ASK_WHICH", t.turnIndex, `reasonCode ask_which indevido`);

    // foto não pode ser enviada/reenviada sem pedido ATUAL.
    if (sentMedia && !isPhotoRequest(lead)) add("critical", "PHOTO_SENT_WITHOUT_REQUEST", t.turnIndex, `send_media sem pedido de foto atual (lead="${lead.slice(0, 40)}")`);

    // pergunta institucional NÃO pode alterar possuiTroca.
    if (isStoreQuestion(lead) && t.possuiTrocaAfter !== t.possuiTrocaBefore) {
      add("critical", "STORE_Q_CHANGED_POSSUI_TROCA", t.turnIndex, `possuiTroca mudou de '${t.possuiTrocaBefore}' p/ '${t.possuiTrocaAfter}' numa pergunta sobre a loja`);
    }

    // pergunta de memória de foto -> responde pela memória (cita o veículo lembrado) SEM tool/mídia.
    if (isPhotoMemoryQuestion(lead)) {
      if (commercialExecuted.length > 0) add("critical", "MEMORY_Q_USED_TOOL", t.turnIndex, `pergunta de memória usou ferramenta comercial: ${commercialExecuted.join(",")}`);
      if (sentMedia) add("critical", "MEMORY_Q_RESENT_MEDIA", t.turnIndex, "pergunta de memória reenviou mídia");
      if (t.wmBeforeLastPhotoLabel) {
        const toks = labelTokens(t.wmBeforeLastPhotoLabel);
        const mentions = toks.some((tok) => norm(resp).includes(tok));
        if (!mentions) add("critical", "MEMORY_Q_NO_RECALL", t.turnIndex, `não citou o veículo lembrado '${t.wmBeforeLastPhotoLabel}' (resp="${resp.slice(0, 50)}")`);
      }
    }

    // ── WARN (diagnóstico forte, não reprova sozinho) ──
    if (isStoreQuestion(lead) && !t.toolsRequested.includes("tenant_business_info")) {
      add("warn", "STORE_Q_NO_BUSINESS_TOOL", t.turnIndex, `pergunta sobre a loja não pediu tenant_business_info (tools=${t.toolsRequested.join(",") || "nenhuma"})`);
    }
    if (t.turnIndex > 1 && /\b(sou o|sou a|me chamo|meu nome e|consultor(a)? (aqui|da)|prazer, sou)\b/.test(norm(resp))) {
      if (introSeen) add("warn", "REINTRODUCED_AGENT", t.turnIndex, "reapresentou o agente após o 1º contato");
    }
    if (/\b(sou o|sou a|consultor)\b/.test(norm(resp))) introSeen = true;
    if (isGreetingOnly(lead) && commercialExecuted.length > 0) {
      add("warn", "UNNECESSARY_TOOL_ON_GREETING", t.turnIndex, `saudação chamou ferramenta comercial: ${commercialExecuted.join(",")}`);
    }
  }

  return { violations: V, criticalCount: V.filter((v) => v.severity === "critical").length, warnCount: V.filter((v) => v.severity === "warn").length };
}
