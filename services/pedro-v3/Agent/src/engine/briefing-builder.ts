// ============================================================================
// briefing-builder.ts — FASE 2 do CRM/Handoff (missão 2026-07-09). Módulo PURO.
//
// Briefing do vendedor construído SÓ de FATOS: ConversationState (slots +
// vehicleContext + adContext + currentObjective + recentTurns) e WorkingMemory
// (lastPhotoAction). NUNCA inventa: dado ausente é OMITIDO ou "não informado".
// TROCA e INTERESSE são seções separadas (colunas separadas na origem — o carro
// do lead jamais aparece como carro de compra e vice-versa).
//
// Formato consistente com o v2 (buildBriefing.ts / buildEnrichedBriefing):
// emoji + nome + dados + próxima ação + wa.me. A CATEGORIA segue a fonte única
// do v2 (leadSdrCategory.ts — 3 categorias do dono, 04/06/2026), reimplementada
// aqui de forma PURA (sem import cross-runtime Deno->Node).
//
// LLM: NÃO participa nesta fase. (Se uma fase futura quiser um parágrafo
// resumido, a LLM recebe ESTE briefing como fato e só REESCREVE — nunca cria.)
// ============================================================================
import type { ConversationState, AdContext } from "../domain/conversation-state.ts";
import { interestVehicleText, tradeVehicleText } from "./crm-write.ts";

export type SdrCategory = "inativo" | "pouco_qualificado" | "qualificado";

type Slots = ConversationState["slots"];
type SlotRecord = Record<string, { status?: string; value?: unknown } | undefined>;
function known(slots: Slots, key: string): unknown {
  const s = (slots as SlotRecord)[key];
  return s?.status === "known" ? s.value : undefined;
}
function textOf(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
function moneyBr(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
}

// Categoria SDR (fonte única do dono, espelho PURO de leadSdrCategory.ts do v2):
// qualificado = nome+interesse+dados suficientes OU pronto p/ transferir; pouco_qualificado = deu dado
// "profundo" (pagamento/entrada/parcela/troca/cidade/visita); inativo = nada coletado de verdade.
export function classifySdrCategory(state: ConversationState, opts?: { readyToTransfer?: boolean }): SdrCategory {
  const s = state.slots;
  const nome = textOf(known(s, "nome"));
  const interesse = interestVehicleText(state, null);
  const deep = [
    known(s, "formaPagamento"), known(s, "entrada"), known(s, "parcelaDesejada"),
    known(s, "veiculoTroca"), known(s, "possuiTroca"), known(s, "cidade"),
    known(s, "diaHorario"), known(s, "interesseVisita"), known(s, "faixaPreco"),
  ].filter((v) => v !== undefined).length;
  if (opts?.readyToTransfer) return "qualificado";
  if (nome && interesse && deep >= 2) return "qualificado";
  if (deep > 0) return "pouco_qualificado";
  return "inativo";
}

const CATEGORY_LINE: Record<SdrCategory, string> = {
  inativo: "🏷️ *Status:* 💤 LEAD INATIVO",
  pouco_qualificado: "🏷️ *Status:* 🧊 LEAD POUCO QUALIFICADO",
  qualificado: "🏷️ *Status:* 🎯 LEAD QUALIFICADO",
};

// Próximo passo SUGERIDO — derivado DETERMINISTICAMENTE do que falta no funil
// (troca -> entrada -> parcela -> visita), nunca inventado.
export function suggestNextStep(state: ConversationState): string {
  const s = state.slots;
  if (known(s, "possuiTroca") === undefined && known(s, "veiculoTroca") === undefined) return "Confirmar se há carro para troca.";
  if (known(s, "possuiTroca") === true && known(s, "veiculoTroca") === undefined) return "Coletar dados do carro de troca (modelo/ano/km) e agendar avaliação.";
  if (known(s, "entrada") === undefined) return "Confirmar valor de entrada.";
  if (known(s, "parcelaDesejada") === undefined && textOf(known(s, "formaPagamento")) !== "a_vista") return "Confirmar parcela que cabe no orçamento.";
  if (known(s, "interesseVisita") === undefined && known(s, "diaHorario") === undefined) return "Convidar para visita/test-drive e combinar dia/horário.";
  if (known(s, "diaHorario") === undefined) return "Fechar dia/horário da visita.";
  return "Lead qualificado — retomar a negociação e fechar.";
}

export type BriefingArgs = {
  readonly state: ConversationState;
  readonly adContext: AdContext | null;                 // anúncio de entrada (se houver)
  readonly adVehicleLabel: string | null;               // veículo do anúncio ATERRADO (nunca texto cru)
  readonly lastPhotoAction: { label: string; photoIds: readonly string[] } | null;  // WM (fotos JÁ enviadas)
  readonly agentName: string;
  readonly leadPhone: string | null;                    // wa.me; omitido se ausente
  readonly recentTurnsLimit?: number;                   // default 6
  readonly readyToTransfer?: boolean;
};

// Briefing completo do vendedor. SÓ fatos; ausência = omissão/"não informado".
export function buildSellerBriefing(args: BriefingArgs): string {
  const { state } = args;
  const s = state.slots;
  const lines: string[] = [];
  const nome = textOf(known(s, "nome")) ?? "não informado";
  const category = classifySdrCategory(state, { readyToTransfer: args.readyToTransfer });
  lines.push(`📋 *LEAD — ${nome}*`);
  lines.push(CATEGORY_LINE[category]);
  const cidade = textOf(known(s, "cidade"));
  if (cidade) lines.push(`🏙️ Cidade: ${cidade}`);
  lines.push("");

  // INTERESSE (compra) — SEPARADO da troca, sempre.
  const interesse = interestVehicleText(state, args.adVehicleLabel);
  lines.push(`🚗 *Interesse:* ${interesse ?? "não informado"}`);
  if (args.adContext) {
    const adBits = [args.adVehicleLabel ? `veículo do anúncio: ${args.adVehicleLabel}` : null, args.adContext.greeting ? `"${args.adContext.greeting.slice(0, 90)}"` : null, args.adContext.source ?? null]
      .filter(Boolean).join(" · ");
    lines.push(`📣 *Origem:* anúncio (tráfego pago)${adBits ? ` — ${adBits}` : ""}`);
  }

  // TROCA (carro DO LEAD) — nunca se mistura com o interesse.
  const troca = tradeVehicleText(s);
  if (troca) lines.push(`🔄 *Troca:* ${troca}`);

  // Pagamento — só o que foi dito.
  const pagamento: string[] = [];
  const forma = textOf(known(s, "formaPagamento"));
  if (forma) pagamento.push(forma);
  const entrada = moneyBr(known(s, "entrada")) ?? (known(s, "entrada") === 0 ? "sem entrada" : null);
  if (entrada) pagamento.push(`entrada ${entrada}`);
  const parcela = moneyBr(known(s, "parcelaDesejada"));
  if (parcela) pagamento.push(`parcela até ${parcela}/mês`);
  const faixa = known(s, "faixaPreco");
  if (faixa && typeof faixa === "object") {
    const max = moneyBr((faixa as { max?: number }).max);
    if (max) pagamento.push(`orçamento até ${max}`);
  }
  if (pagamento.length > 0) lines.push(`💰 *Pagamento:* ${pagamento.join(" · ")}`);

  // Fotos enviadas (fato da WorkingMemory accepted-safe).
  if (args.lastPhotoAction && args.lastPhotoAction.photoIds.length > 0) {
    lines.push(`📸 *Fotos enviadas:* ${args.lastPhotoAction.photoIds.length} do ${args.lastPhotoAction.label}`);
  }

  // Visita.
  const dia = textOf(known(s, "diaHorario"));
  const querVisita = known(s, "interesseVisita");
  if (dia) lines.push(`📅 *Visita:* ${dia}`);
  else if (querVisita === true) lines.push(`📅 *Visita:* quer visitar (dia/horário a combinar)`);
  else if (querVisita === false) lines.push(`📅 *Visita:* não pode visitar — atendimento remoto`);

  // Dúvida/pendência aberta (pergunta do agente ainda sem resposta) — pelo SLOT do objetivo pendente.
  const pending = state.currentObjective;
  if (pending && pending.status === "pending" && pending.slot) {
    const slotLabel: Record<string, string> = {
      nome: "o nome", cidade: "a cidade", interesse: "o modelo de interesse", tipoVeiculo: "o tipo de carro",
      faixaPreco: "a faixa de preço", possuiTroca: "se há carro para troca", veiculoTroca: "os dados do carro de troca",
      entrada: "o valor de entrada", parcelaDesejada: "a parcela desejada", formaPagamento: "a forma de pagamento",
      interesseVisita: "se quer visitar", diaHorario: "o dia/horário da visita", conheceLoja: "se conhece a loja",
    };
    lines.push(`⏳ *Pendente:* aguardando ${slotLabel[pending.slot] ?? `resposta (${pending.slot})`}`);
  }

  // Próximo passo (derivado do funil, nunca inventado).
  lines.push("");
  lines.push(`👉 *Próxima ação sugerida:* ${suggestNextStep(state)}`);

  // Últimas mensagens (fatos do histórico), truncadas.
  const limit = args.recentTurnsLimit ?? 6;
  const turns = (state.recentTurns ?? []).slice(-limit);
  if (turns.length > 0) {
    lines.push("");
    lines.push("🗨️ *Últimas mensagens:*");
    for (const t of turns) {
      const who = t.role === "lead" ? "Cliente" : "IA";
      lines.push(`${who}: ${String(t.text ?? "").replace(/\s+/g, " ").slice(0, 160)}`);
    }
  }

  if (args.leadPhone) {
    const digits = args.leadPhone.replace(/\D/g, "");
    if (digits) { lines.push(""); lines.push(`📲 *Atender:* https://wa.me/${digits}`); }
  }
  lines.push("");
  lines.push(`_Briefing gerado pelo Pedro v3 (${args.agentName})_`);
  return lines.join("\n").slice(0, 3500);
}
