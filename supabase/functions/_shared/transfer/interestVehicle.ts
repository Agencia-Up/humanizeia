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

export function pickInterestVehicleFromState(state: any): string | null {
  if (!state || typeof state !== "object") return null;
  const presented = Array.isArray(state?.veiculos_apresentados) && state.veiculos_apresentados[0]
    ? (state.veiculos_apresentados[0].label ||
        [state.veiculos_apresentados[0].marca, state.veiculos_apresentados[0].modelo, state.veiculos_apresentados[0].ano]
          .filter(Boolean).join(" "))
    : null;
  const candidatos = [
    state?.interesse?.modelo_desejado,   // veiculo do anuncio (titulo completo) ou modelo que o lead pediu
    state?.referencia?.veiculo_citado,   // veiculo citado no anuncio/conversa
    presented,                            // 1o veiculo apresentado pelo agente
    state?.ultima_foto?.veiculo_label,   // ultimo veiculo de que mandou foto
  ];
  for (const c of candidatos) {
    const s = String(c || "").trim();
    // ignora termos genericos que nao ajudam o vendedor
    if (s && !/^(carro|carros|veiculo|veiculos|moto|motos)$/i.test(s)) return s;
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
