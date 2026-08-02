/**
 * actionTaxonomy.ts — José / Fase 1
 *
 * Traduz o `action_type` técnico da Meta para o vocabulário de GOVERNANÇA
 * (`tipo_acao`) usado por jose_permissions, jose_spend_caps e
 * jose_action_approvals. Sem essa tradução, guardrail e permissão não casam
 * com a ação e o portão passa batido.
 *
 * Estas funções estavam duplicadas dentro de jose-agent/index.ts (legado, sem
 * tráfego). Foram extraídas para cá porque agora o caminho CANÔNICO
 * (apollo-agent) precisa exatamente da mesma taxonomia — duas cópias divergindo
 * significaria dois entendimentos diferentes de "o que é ação de orçamento".
 *
 * NOTA DE CONSOLIDAÇÃO (Fase 3): jose-agent segue com a cópia local de
 * propósito — nesta fase não se altera legado. Ao consolidar, apontar o
 * jose-agent para cá e apagar a cópia.
 */

export function mapTipoAcao(actionType: string): string {
  const t = String(actionType || "");
  if (t.includes("pause")) return "pausar_campanha";
  if (t.includes("increase_budget") || t === "scale") return "escalar_orcamento";
  if (t.includes("decrease_budget")) return "reduzir_orcamento";
  if (t.includes("clone") || t.includes("create")) return "criar_campanha";
  if (t.includes("creative") || t.includes("ad_")) return "publicar_criativo";
  if (t.includes("audience") || t.includes("target")) return "ajustar_publico";
  return t || "acao_generica";
}

/** Estima o R$ de orçamento que a ação muda (para cap/gate). Best-effort. */
export function estimateGastoAlterado(action: any): number {
  const p = action?.params || {};
  const cand = p.budget_change ?? p.delta ?? p.new_budget ?? p.daily_budget ?? p.amount ?? 0;
  const n = Number(cand);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

/** Risco da ação (para a fila de aprovação). Orçamento/criação > pausar. */
export function riscoDaAcao(action: any): string {
  const t = String(action?.action_type || "");
  if (t.includes("clone") || t.includes("create")) return "alto";
  if (t.includes("budget")) return estimateGastoAlterado(action) >= 200 ? "alto" : "medio";
  if (t.includes("pause")) return "baixo";
  return "medio";
}

/**
 * Teto duro de sanidade para orçamento. A IA propõe `daily_budget` livremente e
 * o código antigo aceitava qualquer número. Isto é a última barreira antes de
 * mandar para a Meta — independente de caps configurados.
 */
export const LIMITE_ABSOLUTO_ORCAMENTO_DIARIO = Number(
  Deno.env.get("JOSE_LIMITE_ORCAMENTO_DIARIO") || "5000",
);

export function orcamentoPlausivel(valor: unknown): { ok: boolean; motivo?: string } {
  if (valor === undefined || valor === null || valor === "") return { ok: true };
  const n = Number(valor);
  if (!Number.isFinite(n)) return { ok: false, motivo: "orcamento_nao_numerico" };
  if (n < 0) return { ok: false, motivo: "orcamento_negativo" };
  if (n > LIMITE_ABSOLUTO_ORCAMENTO_DIARIO) {
    return { ok: false, motivo: `orcamento_acima_do_limite_absoluto_${LIMITE_ABSOLUTO_ORCAMENTO_DIARIO}` };
  }
  return { ok: true };
}
