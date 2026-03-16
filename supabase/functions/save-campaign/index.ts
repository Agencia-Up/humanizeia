import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const userId = user.id;

    // --- Get org_id from profile ---
    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", userId)
      .single();
    const orgId = profile?.organization_id || null;

    // --- Parse body ---
    const body = await req.json();
    const {
      campaign_id, // null for create, uuid for update
      name,
      message_template,
      prompt_base,
      listas_alvo,
      regras_delay,
      regras_rodizio,
      regras_aquecimento,
      start_time,
      end_time,
      instance_id,
      media_url,
      media_type,
      tags,
      variation_level,
      include_optout_buttons,
      reply_auto_tag,
      reply_auto_message,
    } = body;

    // --- Validation ---
    const errors: string[] = [];

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      errors.push("Nome da campanha é obrigatório.");
    } else if (name.trim().length > 200) {
      errors.push("Nome da campanha deve ter no máximo 200 caracteres.");
    }

    if (
      (!message_template || typeof message_template !== "string" || message_template.trim().length === 0) &&
      (!prompt_base || typeof prompt_base !== "string" || prompt_base.trim().length === 0)
    ) {
      errors.push("Informe a mensagem base ou o prompt para IA.");
    }

    if (message_template && typeof message_template === "string" && message_template.length > 4096) {
      errors.push("Mensagem fixa deve ter no máximo 4096 caracteres.");
    }

    if (prompt_base && typeof prompt_base === "string" && prompt_base.length > 2000) {
      errors.push("Prompt base deve ter no máximo 2000 caracteres.");
    }

    // Validate listas_alvo
    if (listas_alvo !== undefined && listas_alvo !== null) {
      if (!Array.isArray(listas_alvo)) {
        errors.push("listas_alvo deve ser um array de UUIDs.");
      } else {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        for (const id of listas_alvo) {
          if (typeof id !== "string" || !uuidRegex.test(id)) {
            errors.push("listas_alvo contém ID inválido.");
            break;
          }
        }
      }
    }

    // Validate regras_delay
    if (regras_delay !== undefined && regras_delay !== null) {
      if (typeof regras_delay !== "object") {
        errors.push("regras_delay deve ser um objeto JSON.");
      } else {
        const min = regras_delay.min;
        const max = regras_delay.max;
        if (typeof min !== "number" || min < 1 || min > 3600) {
          errors.push("regras_delay.min deve ser entre 1 e 3600.");
        }
        if (typeof max !== "number" || max < 1 || max > 3600) {
          errors.push("regras_delay.max deve ser entre 1 e 3600.");
        }
        if (typeof min === "number" && typeof max === "number" && min > max) {
          errors.push("regras_delay.min não pode ser maior que max.");
        }
      }
    }

    // Validate regras_rodizio
    if (regras_rodizio !== undefined && regras_rodizio !== null) {
      if (typeof regras_rodizio !== "object") {
        errors.push("regras_rodizio deve ser um objeto JSON.");
      } else {
        const msgs = regras_rodizio.mensagens_por_instancia;
        const pausa = regras_rodizio.pausa_entre_instancias;
        if (typeof msgs !== "number" || msgs < 1 || msgs > 1000) {
          errors.push("regras_rodizio.mensagens_por_instancia deve ser entre 1 e 1000.");
        }
        if (typeof pausa !== "number" || pausa < 0 || pausa > 7200) {
          errors.push("regras_rodizio.pausa_entre_instancias deve ser entre 0 e 7200.");
        }
      }
    }

    // Validate regras_aquecimento
    if (regras_aquecimento !== undefined && regras_aquecimento !== null) {
      if (typeof regras_aquecimento !== "object") {
        errors.push("regras_aquecimento deve ser um objeto JSON.");
      } else {
        if (typeof regras_aquecimento.enabled !== "boolean") {
          errors.push("regras_aquecimento.enabled deve ser boolean.");
        }
        if (typeof regras_aquecimento.initial_messages !== "number" || regras_aquecimento.initial_messages < 1 || regras_aquecimento.initial_messages > 1000) {
          errors.push("regras_aquecimento.initial_messages deve ser entre 1 e 1000.");
        }
      }
    }

    // Validate dates
    if (start_time && isNaN(Date.parse(start_time))) {
      errors.push("start_time inválido.");
    }
    if (end_time && isNaN(Date.parse(end_time))) {
      errors.push("end_time inválido.");
    }
    if (start_time && end_time && new Date(start_time) >= new Date(end_time)) {
      errors.push("end_time deve ser posterior a start_time.");
    }

    // Validate media
    if (media_type && !["image", "video", "document", "audio"].includes(media_type)) {
      errors.push("media_type inválido.");
    }
    if (media_url && typeof media_url === "string" && media_url.length > 2048) {
      errors.push("media_url deve ter no máximo 2048 caracteres.");
    }

    // Validate tags
    if (tags !== undefined && tags !== null) {
      if (!Array.isArray(tags)) {
        errors.push("tags deve ser um array.");
      } else if (tags.length > 20) {
        errors.push("Máximo de 20 tags.");
      } else {
        for (const t of tags) {
          if (typeof t !== "string" || t.length > 50) {
            errors.push("Cada tag deve ter no máximo 50 caracteres.");
            break;
          }
        }
      }
    }

    // Validate variation_level
    if (variation_level && !["low", "medium", "high"].includes(variation_level)) {
      errors.push("variation_level deve ser 'low', 'medium' ou 'high'.");
    }

    if (errors.length > 0) {
      return jsonResponse({ error: "Dados inválidos", details: errors }, 400);
    }

    // --- Build payload ---
    const safeName = name.trim().slice(0, 200);
    const safeTemplate = message_template?.trim() || `[IA] ${(prompt_base || "").trim().slice(0, 100)}`;
    const safePrompt = prompt_base?.trim() || null;
    const safeListas = Array.isArray(listas_alvo) ? listas_alvo : [];
    const safeDelay = regras_delay || { min: 35, max: 89 };
    const safeRodizio = regras_rodizio || { mensagens_por_instancia: 10, pausa_entre_instancias: 300 };
    const safeAquecimento = regras_aquecimento || { enabled: false, initial_messages: 20 };

    const payload: Record<string, unknown> = {
      name: safeName,
      message_template: safeTemplate,
      prompt_base: safePrompt,
      // Legacy columns (backward compat)
      list_ids: safeListas,
      min_delay_seconds: safeDelay.min,
      max_delay_seconds: safeDelay.max,
      rotation_messages_per_instance: safeRodizio.mensagens_por_instancia,
      // New JSONB columns
      listas_alvo: safeListas,
      regras_delay: safeDelay,
      regras_rodizio: safeRodizio,
      regras_aquecimento: safeAquecimento,
      start_time: start_time || null,
      end_time: end_time || null,
      scheduled_at: start_time || null,
      instance_id: instance_id || null,
      media_url: media_url || null,
      media_type: media_type || null,
      tags: Array.isArray(tags) && tags.length > 0 ? tags : null,
      organization_id: orgId,
      variation_level: variation_level || 'medium',
      include_optout_buttons: include_optout_buttons === true,
    };

    // Determine status
    if (!campaign_id) {
      payload.status = start_time ? "scheduled" : "draft";
    } else {
      // On update, set to scheduled if start_time provided and was draft
      if (start_time) {
        payload.status = "scheduled";
      }
    }

    // --- Create or Update ---
    // Use service role to ensure org_id is set correctly
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (campaign_id) {
      // Update: verify ownership first
      const { data: existing, error: existErr } = await supabase
        .from("wa_campaigns")
        .select("id, status")
        .eq("id", campaign_id)
        .eq("user_id", userId)
        .single();

      if (existErr || !existing) {
        return jsonResponse({ error: "Campanha não encontrada." }, 404);
      }

      if (!["draft", "paused", "scheduled"].includes(existing.status)) {
        return jsonResponse({ error: "Só é possível editar campanhas em rascunho, pausadas ou agendadas." }, 400);
      }

      const { error: updateErr } = await serviceClient
        .from("wa_campaigns")
        .update(payload)
        .eq("id", campaign_id)
        .eq("user_id", userId);

      if (updateErr) {
        console.error("Update error:", updateErr);
        return jsonResponse({ error: "Erro ao atualizar campanha." }, 500);
      }

      return jsonResponse({ success: true, campaign_id, action: "updated" });
    } else {
      // Create
      payload.user_id = userId;

      const { data: created, error: insertErr } = await serviceClient
        .from("wa_campaigns")
        .insert(payload)
        .select("id")
        .single();

      if (insertErr) {
        console.error("Insert error:", insertErr);
        return jsonResponse({ error: "Erro ao criar campanha." }, 500);
      }

      return jsonResponse({ success: true, campaign_id: created.id, action: "created" }, 201);
    }
  } catch (err) {
    console.error("save-campaign error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Erro interno" },
      500
    );
  }
});
