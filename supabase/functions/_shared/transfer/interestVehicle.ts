// Helper compartilhado: descobre o "veiculo de interesse" do lead para os
// relatorios de transferencia (vendedor e gerente).
//
// PROBLEMA que resolve: um lead de anuncio (CTWA) quase nunca digita o modelo
// (so manda "tenho interesse"). O briefing era gerado por IA SO a partir do
// transcript da conversa -> saia "VEICULO DE INTERESSE: Nao especificado",
// mesmo o anuncio dizendo o carro. O veiculo, porem, JA fica salvo no estado da
// conversa (pedro_conversation_state.state) — via adContextToMemory
// (interesse.modelo_desejado / referencia.veiculo_citado), pelos veiculos
// apresentados ou pela ultima foto. Aqui a gente le esse sinal estruturado.

const _INTEREST_NOISE = new Set([
  "volkswagen", "vw", "chevrolet", "gm", "fiat", "jeep", "hyundai", "toyota", "honda",
  "renault", "ford", "nissan", "mitsubishi", "peugeot", "citroen", "chery", "caoa", "kia",
  "suv", "sedan", "hatch", "picape", "pickup", "automatico", "aut", "manual", "flex", "turbo",
  "tb", "16v", "12v", "8v", "diesel", "gasolina", "cvt",
  "preto", "preta", "branco", "branca", "prata", "prateado", "cinza", "vermelho", "vermelha",
  "azul", "verde", "dourado", "bege", "marrom", "amarelo", "laranja", "vinho",
]);
function _interestTokens(s: any): string[] {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !/^(?:19|20)\d{2}$/.test(w) && !_INTEREST_NOISE.has(w));
}
// O carro APRESENTADO e do MESMO modelo que o lead pediu? (compartilha um token de MODELO,
// ignorando marca/atributo/cor/ano). Se SIM, o apresentado refina a versao do que ele quer.
// Se NAO, o apresentado e uma ALTERNATIVA -> nao e o interesse real do lead.
function _shareModel(presented: any, wanted: any): boolean {
  const p = _interestTokens(presented);
  const w = _interestTokens(wanted);
  return p.length > 0 && w.length > 0 && p.some((t) => w.includes(t));
}

export function pickInterestVehicleFromState(state: any): string | null {
  if (!state || typeof state !== "object") return null;
  const presented = Array.isArray(state?.veiculos_apresentados) && state.veiculos_apresentados[0]
    ? (state.veiculos_apresentados[0].label ||
        [state.veiculos_apresentados[0].marca, state.veiculos_apresentados[0].modelo, state.veiculos_apresentados[0].ano]
          .filter(Boolean).join(" "))
    : null;
  const isGeneric = (s: any) => !String(s || "").trim() || /^(carro|carros|veiculo|veiculos|moto|motos)$/i.test(String(s).trim());
  // O que o lead PEDIU / o veiculo do ANUNCIO — o interesse REAL.
  const wanted = [state?.interesse?.modelo_desejado, state?.referencia?.veiculo_citado]
    .map((s) => String(s || "").trim()).find((s) => s && !isGeneric(s)) || null;
  // BUG corrigido (lead queria T-Cross, anuncio sem estoque -> agente mostrou Pajero -> briefing
  // dizia "interesse: Pajero"): se o lead pediu um modelo e o APRESENTADO e de modelo DIFERENTE
  // (alternativa), o interesse e o que ele PEDIU. So usa o apresentado se for do mesmo modelo
  // (refina versao/ano) — ai e mais especifico e correto.
  if (wanted) {
    if (presented && !isGeneric(presented) && _shareModel(presented, wanted)) return presented;
    return wanted;
  }
  // Lead sem pedido claro de modelo: usa o melhor sinal disponivel.
  for (const c of [presented, state?.ultima_foto?.veiculo_label, state?.referencia?.veiculo_citado]) {
    const s = String(c || "").trim();
    if (s && !isGeneric(s)) return s;
  }
  return null;
}

export async function resolveLeadInterestVehicle(
  supabase: any,
  leadId?: string | null,
  agentId?: string | null,
): Promise<string | null> {
  if (!leadId || !agentId) return null;
  try {
    const { data } = await supabase
      .from("pedro_conversation_state")
      .select("state")
      .eq("lead_id", leadId)
      .eq("agent_id", agentId)
      .maybeSingle();
    return pickInterestVehicleFromState(data?.state);
  } catch {
    return null;
  }
}
