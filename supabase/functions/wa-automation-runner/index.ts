/**
 * wa-automation-runner
 *
 * Processa wa_automation_flows ativos. MVP do executor:
 * - Suporta SOMENTE o nó "add_to_list" (Item 4).
 * - Outros nós (message, email, delay, condition, tag, webhook) são ignorados (log warn).
 *
 * Lógica por flow ativo:
 *   1. Acha o nó trigger e extrai triggerListId.
 *   2. Lista contatos da triggerListId que NÃO estão em wa_automation_runs(flow_id).
 *   3. Pra cada contato:
 *      a. Insere wa_automation_runs (idempotente via UNIQUE(flow_id, contact_id))
 *      b. Faz BFS no grafo a partir do trigger via edges
 *      c. Pra cada nó "add_to_list" alcançável: INSERT em wa_contact_list_members
 *
 * Chamado via cron (a cada 5min). Body vazio. Retorna stats.
 *
 * Idempotente: re-rodar não duplica nada (ON CONFLICT DO NOTHING em ambas inserções).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReactFlowNode {
  id: string;
  type?: string;
  data: { nodeType: string; config?: Record<string, any>; label?: string };
}
interface ReactFlowEdge {
  id: string;
  source: string;
  target: string;
}

function reachableAddToListNodes(nodes: ReactFlowNode[], edges: ReactFlowEdge[], triggerId: string): ReactFlowNode[] {
  // BFS a partir do triggerId; coleta nós cujo nodeType == 'add_to_list'
  const visited = new Set<string>([triggerId]);
  const queue: string[] = [triggerId];
  const addToList: ReactFlowNode[] = [];
  const byId = new Map(nodes.map(n => [n.id, n]));

  while (queue.length > 0) {
    const cur = queue.shift()!;
    // Edges saindo do cur
    for (const e of edges) {
      if (e.source !== cur) continue;
      if (visited.has(e.target)) continue;
      visited.add(e.target);
      queue.push(e.target);
      const targetNode = byId.get(e.target);
      if (targetNode && targetNode.data?.nodeType === 'add_to_list') {
        addToList.push(targetNode);
      }
    }
  }
  return addToList;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const stats = {
    flows_checked: 0,
    flows_processed: 0,
    contacts_added_to_lists: 0,
    runs_created: 0,
    skipped_no_trigger: 0,
    skipped_no_add_to_list: 0,
    errors: [] as string[],
  };

  try {
    // 1. Busca todos os flows ativos
    const { data: flows, error: flowsErr } = await supabase
      .from("wa_automation_flows" as any)
      .select("id, user_id, name, nodes, edges")
      .eq("is_active", true);
    if (flowsErr) throw flowsErr;

    stats.flows_checked = (flows || []).length;
    console.log(`[wa-automation-runner] ${stats.flows_checked} flow(s) ativo(s)`);

    for (const flow of (flows || []) as any[]) {
      try {
        const nodes: ReactFlowNode[] = Array.isArray(flow.nodes) ? flow.nodes : [];
        const edges: ReactFlowEdge[] = Array.isArray(flow.edges) ? flow.edges : [];

        // 2. Acha trigger (tem que ser único pra um flow simples)
        const triggerNode = nodes.find(n => n.data?.nodeType === 'trigger');
        if (!triggerNode) {
          stats.skipped_no_trigger++;
          console.log(`[wa-automation-runner] flow ${flow.id} sem trigger, pulando`);
          continue;
        }
        const triggerListId = triggerNode.data?.config?.triggerListId || triggerNode.data?.config?.listId;
        if (!triggerListId) {
          stats.skipped_no_trigger++;
          console.log(`[wa-automation-runner] flow ${flow.id} trigger sem listId, pulando`);
          continue;
        }

        // 3. Resolve nós add_to_list alcançáveis a partir do trigger
        const addToListNodes = reachableAddToListNodes(nodes, edges, triggerNode.id);
        if (addToListNodes.length === 0) {
          stats.skipped_no_add_to_list++;
          console.log(`[wa-automation-runner] flow ${flow.id} sem add_to_list reachable, pulando`);
          continue;
        }

        // 4. Acha contatos do trigger list que NÃO foram processados por este flow
        const { data: contacts, error: contactsErr } = await supabase
          .from("wa_contacts" as any)
          .select("id, user_id, phone")
          .eq("list_id", triggerListId)
          .eq("user_id", flow.user_id);
        if (contactsErr) {
          stats.errors.push(`flow ${flow.id} contacts: ${contactsErr.message}`);
          continue;
        }
        if (!contacts || contacts.length === 0) {
          console.log(`[wa-automation-runner] flow ${flow.id} sem contatos novos`);
          continue;
        }

        // Filtra os já processados
        const contactIds = (contacts as any[]).map(c => c.id);
        const { data: alreadyProcessed } = await supabase
          .from("wa_automation_runs" as any)
          .select("contact_id")
          .eq("flow_id", flow.id)
          .in("contact_id", contactIds);
        const processedSet = new Set((alreadyProcessed || []).map((r: any) => r.contact_id));
        const newContacts = (contacts as any[]).filter(c => !processedSet.has(c.id));

        if (newContacts.length === 0) {
          console.log(`[wa-automation-runner] flow ${flow.id}: todos os ${contacts.length} contatos já processados`);
          continue;
        }
        console.log(`[wa-automation-runner] flow ${flow.id}: ${newContacts.length} contato(s) novos a processar`);

        // 5. Pra cada contato novo, processa add_to_list nodes
        for (const contact of newContacts) {
          const executedNodes: string[] = [];

          for (const node of addToListNodes) {
            const targetListId = node.data?.config?.targetListId;
            if (!targetListId) {
              console.log(`[wa-automation-runner] flow ${flow.id} node ${node.id} sem targetListId, pulando`);
              continue;
            }
            const { error: addErr } = await supabase
              .from("wa_contact_list_members" as any)
              .upsert({
                contact_id: contact.id,
                list_id: targetListId,
                user_id: contact.user_id,
                added_by: `automation_flow:${flow.id}`,
                added_at: new Date().toISOString(),
              }, { onConflict: 'contact_id,list_id', ignoreDuplicates: true });
            if (addErr) {
              stats.errors.push(`flow ${flow.id} add contact ${contact.id} to list ${targetListId}: ${addErr.message}`);
            } else {
              stats.contacts_added_to_lists++;
              executedNodes.push(node.id);
            }
          }

          // 6. Marca contato como processado (idempotente)
          const { error: runErr } = await supabase
            .from("wa_automation_runs" as any)
            .upsert({
              flow_id: flow.id,
              contact_id: contact.id,
              user_id: flow.user_id,
              status: 'completed',
              started_at: new Date().toISOString(),
              finished_at: new Date().toISOString(),
              executed_nodes: executedNodes,
            }, { onConflict: 'flow_id,contact_id', ignoreDuplicates: true });
          if (runErr) {
            stats.errors.push(`flow ${flow.id} run contact ${contact.id}: ${runErr.message}`);
          } else {
            stats.runs_created++;
          }
        }

        stats.flows_processed++;
      } catch (flowErr: any) {
        stats.errors.push(`flow ${flow.id}: ${flowErr?.message ?? 'erro desconhecido'}`);
      }
    }

    console.log(`[wa-automation-runner] FIM`, JSON.stringify(stats));
    return new Response(JSON.stringify({ success: true, stats }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[wa-automation-runner] erro fatal:", err);
    return new Response(
      JSON.stringify({ error: err?.message ?? "Erro interno", stats }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
