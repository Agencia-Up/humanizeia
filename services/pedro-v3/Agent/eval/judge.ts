// ============================================================================
// eval/judge.ts — JUDGE de qualidade (LLM real gpt-4.1-mini, temperatura 0).
// NÃO é a autoridade única: as asserções determinísticas reprovam por conta.
// Recebe a transcrição JÁ SANITIZADA (TurnCapture.leadText/agentText).
// ============================================================================
import type { RealAssembly, TurnCapture } from "./real-harness.ts";

export type JudgeScore = { readonly overall: number; readonly dims: Record<string, number>; readonly notes: string; readonly raw?: string };

const DIM_KEYS = ["continuidade", "resposta_atual", "conducao_sdr", "naturalidade", "fidelidade_prompt", "uso_ferramentas", "sem_repeticao_alucinacao"] as const;

const RUBRIC = `Voce e um AUDITOR de qualidade de um agente SDR de vendas de carros no WhatsApp (NAO e a autoridade final; assercoes deterministicas ja rodaram a parte). Avalie a conversa por dimensoes, cada uma de 0 a 100:
- continuidade: mantem contexto/memoria entre turnos; nao trata mensagens como isoladas.
- resposta_atual: responde ao pedido/pergunta do TURNO ATUAL.
- conducao_sdr: conduz o funil (uma pergunta por vez, qualifica antes de preco, sempre termina com pergunta de conducao, nao pressiona, nao fecha venda).
- naturalidade: soa humano, varia formulacoes, nao robotico, nao repete a mesma abertura.
- fidelidade_prompt: segue a persona/regras do PROMPT REAL DO PORTAL fornecido abaixo (compare a conversa a ELE: persona, tom, regras de SDR, nunca inventa ano/km/preco, sempre consulta estoque).
- uso_ferramentas: ofertas ancoradas em estoque real; foto quando pedida; nao inventa carro/preco.
- sem_repeticao_alucinacao: nao repete pergunta ja respondida; nao alucina veiculo/preco.
Seja RIGOROSO e especifico. Responda APENAS JSON com inteiros 0-100 por dimensao + "overall" (media ponderada priorizando continuidade, resposta_atual e fidelidade_prompt) + "notes" (2-4 frases em PT-BR apontando o PIOR problema).`;

export async function judgeConversation(assembly: RealAssembly, scenarioTitle: string, turns: readonly TurnCapture[]): Promise<JudgeScore> {
  const transcript = turns.map((t) => `[T${t.turnIndex}] LEAD: ${t.leadText}\n        AGENTE: ${t.agentText}`).join("\n");
  // O prompt REAL do portal vai ao judge apenas EM MEMÓRIA (medir fidelidade_prompt); NUNCA é escrito no relatório.
  const user = `Cenario: ${scenarioTitle}\n\nPROMPT REAL DO PORTAL (referencia p/ fidelidade_prompt — use como gabarito, NAO copie no output):\n"""\n${assembly.portalPrompt}\n"""\n\nTranscricao (LEAD/AGENTE por turno):\n${transcript}\n\nResponda JSON exatamente com as chaves: {"continuidade":int,"resposta_atual":int,"conducao_sdr":int,"naturalidade":int,"fidelidade_prompt":int,"uso_ferramentas":int,"sem_repeticao_alucinacao":int,"overall":int,"notes":"..."}`;
  let raw = "{}";
  try { raw = await assembly.chat(RUBRIC, user); } catch (e) { return { overall: 0, dims: {}, notes: `judge_error: ${String((e as Error)?.message ?? e).slice(0, 80)}` }; }
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(raw) as Record<string, unknown>; } catch { return { overall: 0, dims: {}, notes: "judge_parse_error", raw: raw.slice(0, 160) }; }
  const dims: Record<string, number> = {};
  for (const k of DIM_KEYS) dims[k] = clampScore(j[k]);
  const overall = Number.isFinite(Number(j.overall)) ? clampScore(j.overall) : Math.round(DIM_KEYS.reduce((s, k) => s + dims[k], 0) / DIM_KEYS.length);
  return { overall, dims, notes: typeof j.notes === "string" ? j.notes.slice(0, 400) : "" };
}

function clampScore(x: unknown): number { const n = Number(x); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0; }
