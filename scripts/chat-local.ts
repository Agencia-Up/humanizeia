// =============================================================================
// CHAT LOCAL — REPL interativo do Pedro SDR
// =============================================================================
//
// Roda o agente Pedro localmente no terminal, com TODAS as flags ON por padrão.
// Sem deploy, sem WhatsApp real, sem Supabase. State + history em memória.
//
// MODOS:
//   - MOCK (default): mostra system prompt completo, simula resposta sintética,
//     aplica guardrails + split + typing. Funciona offline, sem keys.
//   - LIVE: se OPENAI_API_KEY estiver setada (em .env.local), chama gpt-4o real
//     e mostra a resposta processada por todas as features.
//
// USO:
//   npm run chat:local
//
// COMANDOS DO REPL:
//   /help              — lista comandos
//   /sair (ou /exit)   — encerra
//   /flags             — mostra estado de todas as flags
//   /flag NOME on|off  — liga/desliga flag específica
//   /state             — mostra state atual (JSON)
//   /state set X.Y=Z   — seta campo (ex: /state set lead.nome=André)
//   /state reset       — limpa state e histórico
//   /history           — mostra mensagens trocadas
//   /prompt            — mostra system prompt que seria enviado AGORA
//   /objecao add NOME  — adiciona objeção no state (ex: nao_pode_visitar)
//   /mode              — alterna MOCK <-> LIVE
//   qualquer outra coisa = mensagem do cliente pro Pedro
// =============================================================================

import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";

import { deriveBantFromState, formatBantBlock } from "../supabase/functions/_shared/qualification/bantSchema";
import { calcLeadScoreV2, formatLeadScoreBlock } from "../supabase/functions/_shared/qualification/leadScoring";
import { buildPersonaFewShotsBlock } from "../supabase/functions/_shared/prompt/personaFewShots";
import { getRelevantPlaybooks, formatObjectionPlaybooksBlock } from "../supabase/functions/_shared/memory/objectionPlaybooks";
import { splitMessageForHumanization } from "../supabase/functions/_shared/humanization/messageSplit";
import { calculateTypingDelayMs } from "../supabase/functions/_shared/humanization/typingSimulator";
import { applyGuardrails } from "../supabase/functions/_shared/reliability/guardrails";
import { newTraceId, slog } from "../supabase/functions/_shared/observability/structuredLog";

// ─── Cores ANSI (sem dep) ──────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

// ─── Leitor manual de .env.local (sem dotenv) ──────────────────────────────
function loadEnvLocal() {
  const candidates = [".env.local", ".env"];
  for (const f of candidates) {
    const full = path.resolve(process.cwd(), f);
    if (!fs.existsSync(full)) continue;
    const raw = fs.readFileSync(full, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const k = trimmed.slice(0, eq).trim();
      let v = trimmed.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  }
}
loadEnvLocal();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// ─── State + flags em memória ──────────────────────────────────────────────
type State = Record<string, any>;
let state: State = {};
const history: Array<{ role: "user" | "assistant"; content: string }> = [];

const flags = {
  MESSAGE_SPLITTING: true,
  TYPING_SIMULATION: true,
  PERSONA_FEW_SHOTS: true,
  BANT_QUALIFICATION: true,
  LEAD_SCORING: true,
  BNDV_SIMILAR_VEHICLES: true,
  HANDOFF_TOOL_V2: true,
  PERSISTENT_PROFILES: true,
  HIERARCHICAL_SUMMARIZATION: true,
  OBJECTION_PLAYBOOKS: true,
  LLM_RETRY_FALLBACK: true,
  GUARDRAILS: true,
  STRUCTURED_LOGGING: true,
};

let mode: "MOCK" | "LIVE" = OPENAI_API_KEY ? "LIVE" : "MOCK";

// ─── Helpers de print ──────────────────────────────────────────────────────
const log = console.log;
function divider(title: string, color = C.cyan) {
  log("");
  log(color + "─".repeat(72));
  log(color + "  " + title + C.reset);
  log(color + "─".repeat(72) + C.reset);
}
function header(text: string) {
  log("\n" + C.bold + C.blue + text + C.reset);
}

// ─── Constrói system prompt em runtime (espelha o webhook) ─────────────────
function buildSystemPrompt(): string {
  const parts: string[] = [];
  parts.push("Você é Pedro, atendente de SDR de uma concessionária automotiva via WhatsApp.");

  // formatStateForPrompt do webhook (simplificado: só os blocos novos)
  const stateLines: string[] = [];
  if (state.lead?.nome) stateLines.push(`✅ Nome: ${state.lead.nome}`);
  if (state.lead?.telefone) stateLines.push(`✅ Telefone: ${state.lead.telefone}`);
  if (state.lead?.cidade) stateLines.push(`✅ Cidade: ${state.lead.cidade}`);
  if (state.interesse?.modelo_desejado) stateLines.push(`✅ Modelo: ${state.interesse.modelo_desejado}`);
  if (state.negociacao?.forma_pagamento) stateLines.push(`✅ Pagamento: ${state.negociacao.forma_pagamento}`);
  if (state.veiculo_apresentado?.ja_apresentado) {
    stateLines.push(`✅ Veículo apresentado: ${state.veiculo_apresentado.modelo || "?"} ${state.veiculo_apresentado.ano || ""}`);
  }
  if (stateLines.length > 0) {
    parts.push("\n## ESTADO DA CONVERSA (dados coletados — NÃO pergunte de novo)");
    parts.push(stateLines.join("\n"));
  }

  if (flags.BANT_QUALIFICATION) {
    const bantBlock = formatBantBlock(deriveBantFromState(state));
    if (bantBlock) parts.push("\n" + bantBlock);
  }
  if (flags.LEAD_SCORING) {
    parts.push("\n" + formatLeadScoreBlock(calcLeadScoreV2(state)));
  }
  if (flags.OBJECTION_PLAYBOOKS) {
    const playbooks = getRelevantPlaybooks(state?.atendimento?.objecoes || []);
    const pb = formatObjectionPlaybooksBlock(playbooks);
    if (pb) parts.push("\n" + pb);
  }
  if (flags.PERSONA_FEW_SHOTS) {
    parts.push("\n" + buildPersonaFewShotsBlock());
  }
  return parts.join("\n");
}

// ─── Chamada LLM (modo LIVE) ───────────────────────────────────────────────
async function callOpenAI(systemPrompt: string, userMessage: string): Promise<string> {
  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userMessage },
  ];
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o", messages, temperature: 0.7 }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI ${res.status}: ${errText}`);
  }
  const data: any = await res.json();
  return data?.choices?.[0]?.message?.content || "";
}

// ─── Resposta sintética (modo MOCK) ────────────────────────────────────────
function mockResponse(userMessage: string): string {
  const t = userMessage.toLowerCase();
  if (t.includes("oi") || t.includes("ola") || t.length < 5) {
    return "Oi! Sou o Pedro 😊 Tô aqui pra te ajudar a achar seu próximo carro. Tá olhando algum modelo?";
  }
  if (t.includes("preço") || t.includes("preco") || t.includes("quanto")) {
    return "O carro sai por R$ 78.900 a vista. Tá pensando em à vista, financiar ou troca?";
  }
  if (t.includes("entrega") || t.includes("frete")) {
    return "Faço a entrega em casa com frete grátis!";
  }
  if (t.includes("tracker") || t.includes("onix") || t.includes("strada")) {
    return "Temos sim! Onix LT Turbo 2022, prata, 38.000 km, R$ 78.900. Quer ver foto? Tá pensando à vista ou financiar?";
  }
  return "Beleza! Pode me contar mais sobre o que você procura?";
}

// ─── Processar 1 turno ─────────────────────────────────────────────────────
async function processTurn(userText: string) {
  const traceId = newTraceId();
  if (flags.STRUCTURED_LOGGING) {
    slog("info", "turn_start", { trace_id: traceId, text_length: userText.length });
  }
  const startMs = Date.now();

  // 1. Constrói system prompt
  const sysPrompt = buildSystemPrompt();

  // 2. Chama LLM ou usa mock
  header(`Pedro responde (modo ${mode})`);
  let aiResponse = "";
  try {
    if (mode === "LIVE") {
      log(C.dim + "  → chamando gpt-4o..." + C.reset);
      aiResponse = await callOpenAI(sysPrompt, userText);
    } else {
      aiResponse = mockResponse(userText);
    }
  } catch (err: any) {
    log(C.red + `  ❌ Erro: ${err.message}` + C.reset);
    return;
  }
  log(C.gray + `  [LLM raw]:` + C.reset + ` ${aiResponse}`);

  // 3. Guardrails (IT-4.2)
  let finalText = aiResponse;
  if (flags.GUARDRAILS) {
    const g = applyGuardrails(aiResponse, state);
    if (g.blocked) {
      log(C.red + `  ⚠️  GUARDRAIL BLOQUEOU: ${g.violations.map((v) => v.rule).join(", ")}` + C.reset);
      if (flags.STRUCTURED_LOGGING) slog("warn", "guardrail_block", { trace_id: traceId, rules: g.violations.map((v) => v.rule) });
      finalText = g.safeFallback;
      log(C.yellow + `  → substituído por: ${finalText}` + C.reset);
    }
  }

  // 4. Split (IT-1.1) + Typing (IT-1.2)
  const parts = flags.MESSAGE_SPLITTING ? splitMessageForHumanization(finalText) : [finalText];
  log("");
  log(C.green + C.bold + `📱 ${parts.length === 1 ? "Mensagem enviada" : `${parts.length} mensagens enviadas`}:` + C.reset);
  for (let i = 0; i < parts.length; i++) {
    if (flags.TYPING_SIMULATION) {
      const delay = Math.round(calculateTypingDelayMs(parts[i]));
      log(C.dim + `  [digitando... ${delay}ms]` + C.reset);
    }
    log(C.green + `  ${parts.length === 1 ? "→" : `[${i + 1}/${parts.length}]`} ${parts[i]}` + C.reset);
  }

  // 5. Update history
  history.push({ role: "user", content: userText });
  history.push({ role: "assistant", content: finalText });

  if (flags.STRUCTURED_LOGGING) {
    slog("info", "turn_end", { trace_id: traceId, latency_ms: Date.now() - startMs, parts_sent: parts.length });
  }
}

// ─── Comandos ──────────────────────────────────────────────────────────────
function setStateDeep(pathStr: string, value: any) {
  const parts = pathStr.split(".");
  let obj: any = state;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!obj[parts[i]] || typeof obj[parts[i]] !== "object") obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  const v = value === "true" ? true : value === "false" ? false : !isNaN(Number(value)) ? Number(value) : value;
  obj[parts[parts.length - 1]] = v;
}

function showHelp() {
  divider("Comandos disponíveis", C.cyan);
  log("  /help                       — mostra esta ajuda");
  log("  /sair                       — encerra o REPL");
  log("  /mode                       — alterna MOCK <-> LIVE");
  log("  /flags                      — mostra estado de cada flag");
  log("  /flag NOME on|off|toggle    — muda flag (ex: /flag GUARDRAILS off)");
  log("  /state                      — mostra state atual");
  log("  /state set X.Y=Z            — seta campo (ex: /state set lead.nome=André)");
  log("  /state reset                — limpa state e history");
  log("  /history                    — mostra histórico de mensagens");
  log("  /prompt                     — mostra system prompt completo");
  log("  /objecao add NOME           — adiciona objeção (ex: /objecao add nao_pode_visitar)");
  log("  /preset cold|warm|hot|qualified  — carrega state pré-pronto");
  log("  qualquer outra coisa        — mensagem do cliente pro Pedro");
}

function applyPreset(name: string) {
  switch (name) {
    case "cold": state = {}; break;
    case "warm": state = { interesse: { modelo_desejado: "Onix" } }; break;
    case "hot": state = { lead: { nome: "André" }, interesse: { modelo_desejado: "Tracker" }, negociacao: { forma_pagamento: "financiado", valor_entrada: "30 mil" } }; break;
    case "qualified": state = { lead: { nome: "Roberta", nome_completo: "Roberta Silva", telefone: "11987654321", cidade: "Taubaté" }, interesse: { modelo_desejado: "Strada", configuracao: "Freedom CD" }, negociacao: { forma_pagamento: "financiado", valor_entrada: "25 mil", tem_troca: false }, veiculo_apresentado: { ja_apresentado: true, modelo: "Strada Freedom CD", ano: 2023, preco: "98.500" } }; break;
    default: log(C.red + `preset desconhecido: ${name} (use: cold/warm/hot/qualified)` + C.reset); return;
  }
  history.length = 0;
  log(C.green + `✓ preset '${name}' carregado, history resetado` + C.reset);
}

function handleCommand(input: string): boolean {
  const cmd = input.trim();
  if (!cmd.startsWith("/")) return false;

  const [head, ...rest] = cmd.slice(1).split(/\s+/);

  if (head === "sair" || head === "exit" || head === "quit") {
    log(C.dim + "tchau!" + C.reset);
    process.exit(0);
  }
  if (head === "help") {
    showHelp();
    return true;
  }
  if (head === "mode") {
    if (mode === "MOCK") {
      if (!OPENAI_API_KEY) {
        log(C.red + "OPENAI_API_KEY não encontrada. Adicione em .env.local pra usar LIVE." + C.reset);
        return true;
      }
      mode = "LIVE";
    } else mode = "MOCK";
    log(C.green + `✓ modo: ${mode}` + C.reset);
    return true;
  }
  if (head === "flags") {
    divider("Flags", C.cyan);
    for (const [k, v] of Object.entries(flags)) {
      log(`  ${(v ? C.green + "✓" : C.gray + "○") + C.reset} ${k}`);
    }
    return true;
  }
  if (head === "flag") {
    const [name, action] = rest;
    if (!(name in flags)) {
      log(C.red + `flag desconhecida: ${name}` + C.reset);
      return true;
    }
    const f: any = flags;
    if (action === "on") f[name] = true;
    else if (action === "off") f[name] = false;
    else if (action === "toggle" || !action) f[name] = !f[name];
    log(C.green + `✓ ${name} = ${f[name]}` + C.reset);
    return true;
  }
  if (head === "state") {
    if (rest[0] === "set") {
      const eq = rest.slice(1).join(" ");
      const idx = eq.indexOf("=");
      if (idx === -1) {
        log(C.red + "formato: /state set caminho=valor" + C.reset);
        return true;
      }
      setStateDeep(eq.slice(0, idx).trim(), eq.slice(idx + 1).trim());
      log(C.green + "✓ state atualizado" + C.reset);
    } else if (rest[0] === "reset") {
      state = {};
      history.length = 0;
      log(C.green + "✓ state + history resetados" + C.reset);
    } else {
      divider("State atual", C.cyan);
      log(JSON.stringify(state, null, 2));
    }
    return true;
  }
  if (head === "history") {
    divider(`History (${history.length} msgs)`, C.cyan);
    for (const m of history) {
      const color = m.role === "user" ? C.blue : C.green;
      log(color + `  ${m.role}:` + C.reset + ` ${m.content}`);
    }
    return true;
  }
  if (head === "prompt") {
    divider("System prompt completo", C.cyan);
    log(buildSystemPrompt());
    return true;
  }
  if (head === "objecao") {
    if (rest[0] === "add" && rest[1]) {
      if (!state.atendimento) state.atendimento = {};
      if (!state.atendimento.objecoes) state.atendimento.objecoes = [];
      state.atendimento.objecoes.push(rest[1]);
      log(C.green + `✓ objeção '${rest[1]}' adicionada` + C.reset);
    } else log(C.red + "formato: /objecao add nao_pode_visitar" + C.reset);
    return true;
  }
  if (head === "preset") {
    applyPreset(rest[0]);
    return true;
  }
  log(C.red + `comando desconhecido: /${head}. Use /help` + C.reset);
  return true;
}

// ─── Boot ──────────────────────────────────────────────────────────────────
function banner() {
  log("");
  log(C.cyan + C.bold + "╔══════════════════════════════════════════════════════════════════════╗" + C.reset);
  log(C.cyan + C.bold + "║                  PEDRO SDR — REPL LOCAL                               ║" + C.reset);
  log(C.cyan + C.bold + "╚══════════════════════════════════════════════════════════════════════╝" + C.reset);
  log("");
  log(`  Modo:  ${mode === "LIVE" ? C.green + "LIVE (gpt-4o real)" : C.yellow + "MOCK (sem LLM)"}${C.reset}`);
  log(`  Flags: ${C.green}TODAS ATIVAS${C.reset} (digite /flags pra ver)`);
  log(`  State: ${C.dim}vazio (digite /preset hot pra ver lead qualificado)${C.reset}`);
  log("");
  log(C.dim + "  Digite /help pra comandos, ou qualquer mensagem pra falar com o Pedro." + C.reset);
  log(C.dim + "  Digite /sair pra encerrar." + C.reset);
  if (!OPENAI_API_KEY) {
    log("");
    log(C.yellow + "  ⚠  Sem OPENAI_API_KEY em .env.local — rodando em MOCK." + C.reset);
    log(C.dim + "     Pra usar LLM real, crie .env.local com OPENAI_API_KEY=sk-..." + C.reset);
  }
}

async function main() {
  banner();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl.setPrompt(C.bold + C.blue + "\nVocê> " + C.reset);
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    try {
      const wasCmd = handleCommand(input);
      if (!wasCmd) await processTurn(input);
    } catch (err: any) {
      log(C.red + "Erro: " + err.message + C.reset);
    }
    rl.prompt();
  });
}

main();
