// ============================================================================
// turn-domain.ts — P0 (missão roteamento por domínio): classifica o DOMÍNIO do turno para que as policies só atuem
// no domínio correto. Uma pergunta INSTITUCIONAL (endereço/horário/loja/contato) NÃO pode ser barrada por policy de
// veículo/funil. Módulo BAIXO NÍVEL (só regex/léxico), importado por central-engine E policy-engine (sem ciclo).
// ============================================================================
import { normalizeText } from "./catalog-utils.ts";
import type { BusinessInfoTopic } from "../domain/agent-brain.ts";

export type TurnDomain = "institutional" | "vehicle_stock" | "vehicle_detail" | "photo" | "sales_funnel" | "other";

// Tópicos resolvíveis pela tool tenant_business_info (address/hours/unit). normalizeText remove acentos.
const INST_ADDRESS_RX = /\benderec|\ba?onde\s+(?:fica|e|esta|estao|fica\s+a\s+loja|voces|a\s+loja)|\blocaliza|\bcomo\s+(?:chego|chegar)|\bfica(?:m)?\s+(?:onde|em|na|no)|\bestacionament/;
const INST_HOURS_RX = /\bhorario|\bque\s+horas|\bfuncionamento|\baberto|\bfecha(?:m|do)?\b|\batende(?:m|ndo)?\b|\bhoras?\s+(?:de\s+)?(?:atend|funcion|abr|fech)|\babre(?:m)?\s+(?:sabado|domingo|hoje|amanha)/;
const INST_UNIT_RX = /\bunidade|\bfilia|\bmatriz|\bqual\s+loja/;
// Contato: instagram/site/telefone/whats/redes — INSTITUCIONAL, respondido do PROMPT (não é topic da tool).
const INST_CONTACT_RX = /\binstagram\b|\binsta\b|\bsite\b|\bwhats|\bwpp\b|\btelefone\b|\bfone\b|\bcontato\b|\bface(?:book)?\b|\bredes?\s+sociais\b|\bnumero\s+(?:de\s+)?(?:voces|contato|telefone)/;

export function institutionalTopicsRequested(block: string): BusinessInfoTopic[] {
  const n = normalizeText(block);
  const out: BusinessInfoTopic[] = [];
  if (INST_ADDRESS_RX.test(n)) out.push("address");
  if (INST_HOURS_RX.test(n)) out.push("hours");
  if (INST_UNIT_RX.test(n)) out.push("unit");
  return out;
}
export function mentionsContact(block: string): boolean { return INST_CONTACT_RX.test(normalizeText(block)); }

// TRUE quando o bloco atual é uma pergunta INSTITUCIONAL (endereço/horário/loja/unidade/contato). É o gatilho para
// as policies de VEÍCULO/FUNIL se ABSTEREM (o institucional é validado só contra os fatos institucionais/prompt/tool).
export function isInstitutionalTurn(block: string): boolean {
  return institutionalTopicsRequested(block).length > 0 || mentionsContact(block);
}
