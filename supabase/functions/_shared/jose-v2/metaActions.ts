/**
 * metaActions.ts — José v3.1 / Fase 0
 *
 * Executa uma ação aprovada na Meta (pausar/ativar/orçamento). Mesma lógica do
 * executeMetaAction do jose-agent, isolada aqui pra o jose-approval-handler
 * executar a ação guardada quando o dono responde SIM — sem reimplementar.
 */

const META_GRAPH_URL = "https://graph.facebook.com/v21.0";

export async function executeMetaAction(accessToken: string, action: any) {
  try {
    const targetId = action.adset_id || action.campaign_id;

    if (action.action_type === "pause" || action.action_type === "activate" ||
        action.action_type === "pause_adset" || action.action_type === "activate_adset") {
      const status = (action.action_type === "pause" || action.action_type === "pause_adset") ? "PAUSED" : "ACTIVE";
      const url = new URL(`${META_GRAPH_URL}/${targetId}`);
      url.searchParams.set("access_token", accessToken);
      url.searchParams.set("status", status);
      const res = await fetch(url.toString(), { method: "POST" });
      const data = await res.json();
      return { success: !data.error, data, action_type: action.action_type };
    }

    if (action.action_type === "increase_budget" || action.action_type === "decrease_budget") {
      const url = new URL(`${META_GRAPH_URL}/${action.campaign_id}`);
      url.searchParams.set("access_token", accessToken);
      if (action.params?.daily_budget) {
        url.searchParams.set("daily_budget", String(Math.round(action.params.daily_budget)));
      }
      const res = await fetch(url.toString(), { method: "POST" });
      const data = await res.json();
      return { success: !data.error, data, action_type: action.action_type };
    }

    return { success: true, data: { message: "Ação registrada" }, action_type: action.action_type };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err), action_type: action.action_type };
  }
}
