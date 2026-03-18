import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const formId = url.searchParams.get("form_id");
    if (!formId) {
      return new Response(JSON.stringify({ error: "form_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { name, email, phone, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, custom_data } = body;

    if (!phone && !email) {
      return new Response(JSON.stringify({ error: "phone or email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify form exists and is active
    const { data: form, error: formError } = await supabase
      .from("capture_forms")
      .select("*")
      .eq("id", formId)
      .eq("is_active", true)
      .single();

    if (formError || !form) {
      return new Response(JSON.stringify({ error: "Form not found or inactive" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert submission
    const { data: submission, error: subError } = await supabase
      .from("capture_form_submissions")
      .insert({
        form_id: formId,
        name: name || null,
        email: email || null,
        phone: phone || null,
        utm_source: utm_source || null,
        utm_medium: utm_medium || null,
        utm_campaign: utm_campaign || null,
        utm_content: utm_content || null,
        utm_term: utm_term || null,
        fbclid: fbclid || null,
        custom_data: custom_data || {},
        ip_address: req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || null,
        user_agent: req.headers.get("user-agent") || null,
        status: "processing",
      })
      .select()
      .single();

    if (subError) throw subError;

    // Process auto-actions
    const errors: string[] = [];

    // 1. Auto-create WhatsApp contact
    if (form.auto_create_contact && phone) {
      try {
        const cleanPhone = phone.replace(/\D/g, "");
        const { error: contactErr } = await supabase.from("wa_contacts").upsert(
          {
            user_id: form.user_id,
            phone: cleanPhone,
            name: name || cleanPhone,
            tags: form.tags || [],
            utm_source: utm_source || null,
            utm_medium: utm_medium || null,
            utm_campaign: utm_campaign || null,
          },
          { onConflict: "user_id,phone" }
        );
        if (contactErr) errors.push(`contact: ${contactErr.message}`);
      } catch (e: any) {
        errors.push(`contact: ${e.message}`);
      }
    }

    // 2. Auto-send WhatsApp welcome message
    if (form.auto_send_whatsapp && phone && form.instance_id && form.welcome_message) {
      try {
        // Get instance details
        const { data: instance } = await supabase
          .from("wa_instances")
          .select("instance_name, api_url, api_key")
          .eq("id", form.instance_id)
          .eq("is_active", true)
          .single();

        if (instance) {
          const cleanPhone = phone.replace(/\D/g, "");
          // Replace variables in message
          let message = form.welcome_message
            .replace(/{nome}/g, name || "")
            .replace(/{email}/g, email || "")
            .replace(/{telefone}/g, phone || "");

          const apiUrl = instance.api_url || Deno.env.get("EVOLUTION_API_URL");
          const apiKey = instance.api_key || Deno.env.get("EVOLUTION_API_KEY");

          if (apiUrl && apiKey) {
            const sendRes = await fetch(
              `${apiUrl}/message/sendText/${instance.instance_name}`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  apikey: apiKey,
                },
                body: JSON.stringify({
                  number: cleanPhone,
                  text: message,
                }),
              }
            );
            if (!sendRes.ok) {
              const errBody = await sendRes.text();
              errors.push(`whatsapp: ${errBody}`);
            }
          }
        }
      } catch (e: any) {
        errors.push(`whatsapp: ${e.message}`);
      }
    }

    // 3. Auto-add to CRM
    if (form.auto_add_to_crm) {
      try {
        const { error: crmErr } = await supabase.from("crm_leads").insert({
          user_id: form.user_id,
          name: name || phone || email || "Lead",
          email: email || null,
          phone: phone || null,
          source: `form:${form.name}`,
          stage: "lead",
          tags: form.tags || [],
        });
        if (crmErr) errors.push(`crm: ${crmErr.message}`);
      } catch (e: any) {
        errors.push(`crm: ${e.message}`);
      }
    }

    // 4. Auto-fire CAPI event
    if (form.auto_fire_capi && phone) {
      try {
        // Get active pixel
        const { data: pixel } = await supabase
          .from("meta_pixels")
          .select("id, pixel_id, access_token")
          .eq("user_id", form.user_id)
          .eq("is_active", true)
          .limit(1)
          .single();

        if (pixel) {
          await supabase.functions.invoke("meta-capi-send", {
            body: {
              pixel_id: pixel.id,
              events: [
                {
                  event_name: "Lead",
                  action_source: "website",
                  user_data: {
                    ph: [phone.replace(/\D/g, "")],
                    ...(email && { em: [email] }),
                  },
                  custom_data: {
                    source: `form:${form.name}`,
                    utm_source: utm_source || undefined,
                    utm_campaign: utm_campaign || undefined,
                  },
                },
              ],
            },
          });
        }
      } catch (e: any) {
        errors.push(`capi: ${e.message}`);
      }
    }

    // Update submission status
    await supabase
      .from("capture_form_submissions")
      .update({
        status: errors.length > 0 ? "partial" : "processed",
        processed_at: new Date().toISOString(),
        error_message: errors.length > 0 ? errors.join("; ") : null,
      })
      .eq("id", submission.id);

    return new Response(
      JSON.stringify({
        success: true,
        submission_id: submission.id,
        redirect_url: form.redirect_url || null,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("Capture form webhook error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
