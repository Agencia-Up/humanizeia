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
import { interestVehicleText, isRealLeadName, sanitizeLeadNameHint, tradeVehicleText } from "./crm-write.ts";

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

export type BriefingHandoffReason =
  | "explicit_human_request"
  | "qualified_handoff"
  | "followup_timeout_handoff"
  | "silent_disengagement_handoff"
  | "returning_lead_renotify";

type BriefingContext = {
  readonly handoffReason?: BriefingHandoffReason | null;
  readonly adContext?: AdContext | null;
  readonly adVehicleLabel?: string | null;
  readonly lastPhotoAction?: { label: string; photoIds: readonly string[] } | null;
};

function vehicleLabel(item: { marca?: string | null; modelo?: string | null; ano?: number | null }): string | null {
  const text = [item.marca, item.modelo, item.ano != null ? String(item.ano) : null].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return text || null;
}

function offeredVehicleLabels(state: ConversationState): string[] {
  return (state.lastRenderedOfferContext?.items ?? []).map(vehicleLabel).filter((value): value is string => value != null);
}

function adDescription(ad: AdContext | null | undefined, adVehicleLabel: string | null | undefined): string | null {
  if (!ad) return null;
  const descriptor = adVehicleLabel?.trim()
    || ad.title?.replace(/\s+/g, " ").trim()
    || ad.body?.replace(/\s+/g, " ").trim().slice(0, 100)
    || null;
  const source = ad.source?.replace(/\s+/g, " ").trim() || null;
  if (descriptor && source) return `${descriptor} (${source})`;
  return descriptor || source || "anúncio de tráfego pago";
}

function leadTopics(state: ConversationState): string[] {
  const text = (state.recentTurns ?? []).filter((turn) => turn.role === "lead").map((turn) => turn.text).join(" \n ")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const topics: string[] = [];
  const add = (label: string, rx: RegExp): void => { if (rx.test(text)) topics.push(label); };
  add("fotos", /\b(?:foto|fotos|imagem|imagens)\b/);
  add("garantia", /\bgaranti/);
  add("financiamento/condições", /\b(?:financi|condi[cç][aã]o|entrada|parcela)\b/);
  add("troca", /\b(?:troca|dar meu carro|meu veiculo|meu carro)\b/);
  add("localização/horário da loja", /\b(?:onde fica|endereco|loja|horario)\b/);
  add("visita/test-drive", /\b(?:visita|visitar|test.?drive|conhecer o carro)\b/);
  add("preço", /\b(?:pre[cç]o|valor|quanto custa)\b/);
  return topics;
}

function leadDisplayName(args: Pick<BriefingArgs, "state" | "leadDisplayName" | "leadPhone">): string {
  const declared = textOf(known(args.state.slots, "nome"));
  if (declared && isRealLeadName(declared)) return declared;
  const hinted = sanitizeLeadNameHint(args.leadDisplayName);
  if (hinted && isRealLeadName(hinted)) return hinted;
  const digits = String(args.leadPhone ?? "").replace(/\D/g, "");
  return digits ? `Contato WhatsApp • final ${digits.slice(-4)}` : "Contato do WhatsApp";
}

function interestSummary(state: ConversationState, adVehicleLabel: string | null | undefined): string | null {
  return interestVehicleText(state, adVehicleLabel ?? null)
    || textOf(known(state.slots, "tipoVeiculo"))
    || null;
}

// Próximo passo operacional para o vendedor. Ele usa o estágio REAL do atendimento,
// não uma ordem fixa de perguntas do funil. O prompt do portal continua sendo a
// autoridade da conversa; isto é apenas uma recomendação no briefing interno.
export function suggestNextStep(state: ConversationState, context: BriefingContext = {}): string {
  const s = state.slots;
  const selected = state.vehicleContext.selected?.label?.trim() || null;
  const interest = interestSummary(state, context.adVehicleLabel);
  const offered = offeredVehicleLabels(state);
  const visitAt = textOf(known(s, "diaHorario"));
  if (context.handoffReason === "explicit_human_request") {
    return `Assumir o atendimento agora${interest ? ` e responder sobre ${interest}` : ""}, sem repetir perguntas já respondidas.`;
  }
  if (context.handoffReason === "followup_timeout_handoff") {
    if (offered.length > 0) return `Retomar as ${offered.length} opções apresentadas e perguntar qual chamou mais atenção; oferecer fotos, detalhes ou alternativas.`;
    if (interest) return `Retomar o interesse em ${interest} e oferecer fotos, detalhes ou opções equivalentes.`;
    return "Retomar o contato pelo contexto já coletado e entender qual veículo faz sentido, sem reiniciar o atendimento.";
  }
  if (context.handoffReason === "silent_disengagement_handoff") {
    return "Registrar o encerramento e acompanhar o lead sem retomar a abordagem agora; só responder se ele voltar a demonstrar interesse.";
  }
  if (visitAt) return `Confirmar a visita em ${visitAt} e alinhar quem receberá o cliente na loja.`;
  if (known(s, "interesseVisita") === true) return `Combinar dia e horário da visita${selected ? ` ao ${selected}` : interest ? ` para ver ${interest}` : ""}.`;
  if (selected && context.lastPhotoAction?.photoIds.length) return `Retomar o ${selected}, confirmar as dúvidas após as fotos e avançar para condições ou visita.`;
  if (selected) return `Retomar o interesse no ${selected} e avançar para fotos, condições ou visita conforme a necessidade do cliente.`;
  if (offered.length > 0) return `Perguntar qual das ${offered.length} opções apresentadas chamou mais atenção e oferecer fotos ou detalhes do escolhido.`;
  if (interest) return `Continuar a partir do interesse em ${interest}, confirmando a necessidade atual antes de apresentar a melhor opção.`;
  if (context.adContext) return `Confirmar o interesse no ${adDescription(context.adContext, context.adVehicleLabel) ?? "anúncio"} e atender a solicitação atual do cliente.`;
  if (known(s, "possuiTroca") === true && known(s, "veiculoTroca") === undefined) return "Coletar dados do carro de troca (modelo/ano/km) e agendar avaliação.";
  return "Responder ao cliente e identificar o veículo ou necessidade principal antes de avançar a negociação.";
}

export type BriefingArgs = {
  readonly state: ConversationState;
  readonly adContext: AdContext | null;                 // anúncio de entrada (se houver)
  readonly adVehicleLabel: string | null;               // veículo do anúncio ATERRADO (nunca texto cru)
  readonly lastPhotoAction: { label: string; photoIds: readonly string[] } | null;  // WM (fotos JÁ enviadas)
  readonly agentName: string;
  readonly leadPhone: string | null;                    // wa.me; omitido se ausente
  readonly leadDisplayName?: string | null;             // pushName/lead_name sanitizado; nome declarado continua prioritário
  readonly handoffReason?: BriefingHandoffReason | null;
  readonly recentTurnsLimit?: number;                   // default 6
  readonly readyToTransfer?: boolean;
};

// Resumo factual e legível para o vendedor. Não é transcrição e não chama uma
// segunda LLM: usa somente fatos aceitos no estado, portanto não inventa nem
// adiciona custo/latência à transferência.
export function buildAgentSummary(args: BriefingArgs): string[] {
  const { state } = args;
  const summary: string[] = [];
  const ad = adDescription(args.adContext, args.adVehicleLabel);
  const interest = interestSummary(state, args.adVehicleLabel);
  const selected = state.vehicleContext.selected?.label?.trim() || null;
  const offered = offeredVehicleLabels(state);
  const topics = leadTopics(state);
  const troca = tradeVehicleText(state.slots);
  const entrada = moneyBr(known(state.slots, "entrada")) ?? (known(state.slots, "entrada") === 0 ? "sem entrada" : null);
  const parcela = moneyBr(known(state.slots, "parcelaDesejada"));
  const visita = textOf(known(state.slots, "diaHorario"));

  if (ad) summary.push(`Chegou pelo anúncio de ${ad}.`);
  if (interest) summary.push(`Demonstrou interesse em ${interest}.`);
  if (offered.length > 0) {
    const labels = offered.slice(0, 5).join(", ");
    summary.push(`Recebeu ${offered.length} ${offered.length === 1 ? "opção" : "opções"}${labels ? `: ${labels}` : ""}.`);
  }
  if (selected) summary.push(`Escolheu ou destacou o ${selected}.`);
  if (args.lastPhotoAction?.photoIds.length) summary.push(`Recebeu ${args.lastPhotoAction.photoIds.length} foto${args.lastPhotoAction.photoIds.length === 1 ? "" : "s"} do ${args.lastPhotoAction.label}.`);
  if (topics.length > 0) summary.push(`Assuntos tratados: ${topics.join(", ")}.`);
  if (troca) summary.push(`Informou troca: ${troca}.`);
  if (entrada || parcela) summary.push(`Condição informada: ${[entrada ? `entrada ${entrada}` : null, parcela ? `parcela até ${parcela}/mês` : null].filter(Boolean).join(" e ")}.`);
  if (visita) summary.push(`Visita combinada para ${visita}.`);
  else if (known(state.slots, "interesseVisita") === true) summary.push("Demonstrou interesse em visitar a loja; data e horário ainda precisam ser combinados.");
  if (args.handoffReason === "followup_timeout_handoff") {
    summary.push(offered.length > 0 ? "Ficou inativo após receber as opções." : "Ficou inativo antes de concluir o atendimento.");
  } else if (args.handoffReason === "silent_disengagement_handoff") {
    summary.push("Encerrou o atendimento sem interesse nas opções apresentadas; transferência feita em silêncio para acompanhamento.");
  } else if (args.handoffReason === "explicit_human_request") {
    summary.push("Pediu atendimento humano diretamente.");
  } else if (args.handoffReason === "qualified_handoff") {
    summary.push("Chegou ao ponto de continuidade com o vendedor.");
  }
  if (summary.length === 0) summary.push("Iniciou o contato, mas ainda não informou o veículo ou a necessidade principal.");
  return summary;
}

// Briefing completo do vendedor. SÓ fatos; ausência = omissão/"não informado".
export function buildSellerBriefing(args: BriefingArgs): string {
  const { state } = args;
  const s = state.slots;
  const lines: string[] = [];
  const nome = leadDisplayName(args);
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

  // Resumo do agente: fatos consolidados, sem transcrição crua.
  lines.push("");
  lines.push("📝 *Resumo do agente:*");
  for (const item of buildAgentSummary(args)) lines.push(`• ${item}`);

  // Próximo passo contextual para o vendedor.
  lines.push("");
  lines.push(`👉 *Próxima ação sugerida:* ${suggestNextStep(state, args)}`);

  if (args.leadPhone) {
    const digits = args.leadPhone.replace(/\D/g, "");
    if (digits) { lines.push(""); lines.push(`📲 *Atender:* https://wa.me/${digits}`); }
  }
  lines.push("");
  lines.push(`_Briefing gerado pelo Pedro v3 (${args.agentName})_`);
  return lines.join("\n").slice(0, 3500);
}
