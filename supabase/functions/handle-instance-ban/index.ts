import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Esta funcao e INTERNA: so o process-whatsapp-queue a chama, sempre com a
    // service role key no header. Sem essa trava, qualquer um com a anon key
    // publica poderia disparar o failover (reescrever a instancia dos contatos
    // e enfileirar mensagens) de OUTRA conta passando o user_id no body.
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!bearer || bearer !== serviceKey) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceKey
    );

    const { instance_id, user_id } = await req.json();

    if (!instance_id || !user_id) {
      return new Response(
        JSON.stringify({ error: "instance_id and user_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Mark instance as processing failover
    await supabase
      .from("wa_instances")
      .update({ failover_status: "processing" })
      .eq("id", instance_id);

    // 2. Find warm contacts (interacted in last 7 days) linked to this instance
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: warmContacts, error: contactsErr } = await supabase
      .from("wa_contacts")
      .select("id, phone, name, metadata, last_message_at, current_instance_id")
      .eq("user_id", user_id)
      .gte("last_message_at", sevenDaysAgo)
      .or(`current_instance_id.eq.${instance_id},current_instance_id.is.null`);

    if (contactsErr) {
      console.error("Error fetching warm contacts:", contactsErr);
      await supabase.from("wa_instances").update({ failover_status: "failed" }).eq("id", instance_id);
      return new Response(
        JSON.stringify({ error: "Failed to fetch contacts" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!warmContacts || warmContacts.length === 0) {
      await supabase.from("wa_instances").update({ failover_status: "completed" }).eq("id", instance_id);
      await logAudit(supabase, user_id, "failover_no_contacts", instance_id, null, {
        message: "No warm contacts to failover",
      });
      return new Response(
        JSON.stringify({ success: true, failovered: 0, message: "No warm contacts" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Find a healthy replacement instance
    const { data: healthyInstances } = await supabase
      .from("wa_instances")
      .select("id, instance_name, health_score, phone_number, provider")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .eq("status", "connected")
      .neq("id", instance_id)
      .gte("health_score", 50)
      .order("health_score", { ascending: false })
      .limit(1);

    if (!healthyInstances || healthyInstances.length === 0) {
      await supabase.from("wa_instances").update({ failover_status: "failed" }).eq("id", instance_id);
      await logAudit(supabase, user_id, "failover_no_healthy_instance", instance_id, null, {
        warm_contacts_count: warmContacts.length,
      });
      return new Response(
        JSON.stringify({ success: false, error: "No healthy instances available for failover" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const newInstance = healthyInstances[0];
    let failoveredCount = 0;

    // 4. Generate continuity messages and enqueue
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    for (const contact of warmContacts) {
      try {
        let continuityMessage = `Olá${contact.name ? ` ${contact.name}` : ""}, este é nosso novo número de contato. Salvando este número você garante que nosso atendimento continue sem interrupções. Estamos à disposição!`;

        // Generate AI personalized message if API key available
        if (LOVABLE_API_KEY) {
          try {
            // Fetch last 3 messages for context
            const { data: recentMsgs } = await supabase
              .from("wa_inbox")
              .select("content, direction")
              .eq("phone", contact.phone)
              .eq("user_id", user_id)
              .order("created_at", { ascending: false })
              .limit(3);

            const historyContext = recentMsgs
              ?.map((m: any) => `${m.direction === "incoming" ? "Lead" : "Nós"}: ${m.content || "[mídia]"}`)
              .reverse()
              .join("\n") || "";

            const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash-lite",
                messages: [
                  {
                    role: "system",
                    content: `Você é um assistente que precisa informar um contato sobre mudança de número de WhatsApp. 
Regras:
- Tom profissional e amigável
- Personalize com o nome se disponível
- Mencione que é continuidade de conversa
- Incentive salvar o novo número
- MÁXIMO 250 caracteres
- Sem emojis em excesso (máx 2)
- Responda APENAS com o texto da mensagem`,
                  },
                  {
                    role: "user",
                    content: `Nome do contato: ${contact.name || "não informado"}
Histórico recente: ${historyContext || "sem histórico"}

Gere uma mensagem de continuidade única e natural.`,
                  },
                ],
                temperature: 0.8,
                max_tokens: 200,
              }),
            });

            if (response.ok) {
              const aiData = await response.json();
              const aiContent = aiData.choices?.[0]?.message?.content?.trim();
              if (aiContent) continuityMessage = aiContent;
            }
          } catch (aiErr) {
            console.warn("AI failover message generation failed, using template:", aiErr);
          }
        }

        // Enqueue the continuity message
        await supabase.from("wa_queue").insert({
          user_id,
          campaign_id: null,
          contact_id: contact.id,
          phone: contact.phone,
          message: continuityMessage,
          status: "pending",
          scheduled_for: new Date().toISOString(),
          instance_id: newInstance.id,
          contact_name: contact.name,
          contact_metadata: contact.metadata,
        });

        // Update contact's current instance
        await supabase
          .from("wa_contacts")
          .update({ current_instance_id: newInstance.id })
          .eq("id", contact.id);

        failoveredCount++;
      } catch (contactErr) {
        console.error(`Failover error for contact ${contact.id}:`, contactErr);
      }
    }

    // 5. Mark failover as completed
    await supabase
      .from("wa_instances")
      .update({ failover_status: "completed" })
      .eq("id", instance_id);

    // 6. Log audit event
    await logAudit(supabase, user_id, "failover_completed", instance_id, null, {
      banned_instance_id: instance_id,
      new_instance_id: newInstance.id,
      warm_contacts_total: warmContacts.length,
      failovered_count: failoveredCount,
    });

    return new Response(
      JSON.stringify({
        success: true,
        failovered: failoveredCount,
        new_instance_id: newInstance.id,
        total_warm_contacts: warmContacts.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("handle-instance-ban error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function logAudit(
  supabase: any,
  userId: string,
  eventType: string,
  instanceId: string | null,
  contactId: string | null,
  details: Record<string, any>
) {
  try {
    await supabase.from("wa_audit_logs").insert({
      user_id: userId,
      event_type: eventType,
      instance_id: instanceId,
      contact_id: contactId,
      details,
    });
  } catch (err) {
    console.error("Audit log error:", err);
  }
}
