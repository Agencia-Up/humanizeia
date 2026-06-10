import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCalendarAccess } from "../_shared/google-calendar.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BNDV_API_URL = "https://api-estoque.azurewebsites.net/graphql";

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id;
}

async function testGA4(credentials: { measurement_id: string; api_secret: string }) {
  if (!/^G-[A-Z0-9]+$/i.test(credentials.measurement_id)) {
    return { success: false, message: "Measurement ID inválido. Formato esperado: G-XXXXXXXXXX" };
  }
  if (!credentials.api_secret?.trim()) {
    return { success: false, message: "API Secret é obrigatório." };
  }

  try {
    const res = await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${credentials.measurement_id}&api_secret=${credentials.api_secret}`,
      {
        method: "POST",
        body: JSON.stringify({
          client_id: "test_validation",
          events: [{ name: "test_connection", params: {} }],
        }),
      }
    );

    if (res.status === 204 || res.status === 200) {
      return { success: true, message: "Conexão validada com sucesso!" };
    }

    return { success: false, message: `Erro na validação (status ${res.status})` };
  } catch {
    return { success: false, message: "Não foi possível conectar ao Google Analytics." };
  }
}

async function testHotmart(credentials: { api_token: string }) {
  try {
    const res = await fetch("https://developers.hotmart.com/payments/api/v1/sales/summary", {
      headers: {
        Authorization: `Bearer ${credentials.api_token}`,
        "Content-Type": "application/json",
      },
    });

    if (res.ok) {
      return { success: true, message: "Token Hotmart validado com sucesso!" };
    }

    const data = await res.json().catch(() => null);
    return { success: false, message: data?.message || `Erro (status ${res.status})` };
  } catch {
    return { success: false, message: "Não foi possível conectar à API da Hotmart." };
  }
}

async function testWebhook(credentials: { webhook_url: string; secret?: string }) {
  try {
    const res = await fetch(credentials.webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(credentials.secret ? { "X-Webhook-Secret": credentials.secret } : {}),
      },
      body: JSON.stringify({
        event: "test",
        message: "Teste de conexão do LogosIA",
        timestamp: new Date().toISOString(),
      }),
    });

    if (res.ok) {
      return { success: true, message: "Webhook respondeu com sucesso!" };
    }

    return { success: false, message: `Webhook retornou status ${res.status}` };
  } catch (error: any) {
    return { success: false, message: `Erro ao conectar: ${error.message}` };
  }
}

async function testGoogleSheets(credentials: { api_key: string; sheet_id: string }) {
  try {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${credentials.sheet_id}?key=${credentials.api_key}&fields=properties.title`
    );

    if (res.ok) {
      const data = await res.json();
      return { success: true, message: `Planilha "${data.properties?.title}" encontrada!` };
    }

    return {
      success: false,
      message: "Não foi possível acessar a planilha. Verifique a API Key e o Sheet ID.",
    };
  } catch {
    return { success: false, message: "Erro ao conectar ao Google Sheets." };
  }
}

async function testGoogleCalendar(credentials: { calendar_id: string }) {
  const result = await checkCalendarAccess(credentials?.calendar_id);
  return { success: result.ok, message: result.message };
}

async function testBndv(credentials: { api_token: string }) {
  if (!credentials.api_token?.trim()) {
    return { success: false, message: "Bearer Token é obrigatório." };
  }

  try {
    const res = await fetch(BNDV_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.api_token.trim()}`,
      },
      body: JSON.stringify({
        query: `
          query ValidateBndvConnection {
            vehiclesBy {
              modelName
              markName
              year
              saleValue
            }
          }
        `,
      }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        success: false,
        message:
          data?.errors?.[0]?.message ||
          data?.message ||
          `BNDV retornou status ${res.status}.`,
      };
    }

    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      return {
        success: false,
        message: data.errors[0]?.message || "A API do BNDV retornou um erro ao validar a chave.",
      };
    }

    const vehicles = Array.isArray(data?.data?.vehiclesBy) ? data.data.vehiclesBy : [];

    return {
      success: true,
      message:
        vehicles.length > 0
          ? `Conexão validada! ${vehicles.length} veículo(s) retornado(s) no teste.`
          : "Conexão validada! A chave respondeu corretamente, mas nenhum veículo foi retornado no teste.",
    };
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "Não foi possível conectar à API do BNDV.",
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const userId = await getAuthenticatedUser(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const { platform, credentials, action } = await req.json();

    if (action === "save") {
      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      const integrationPayload = {
        user_id: userId,
        platform,
        api_key_encrypted: JSON.stringify(credentials),
        store_url: platform === "bndv" ? BNDV_API_URL : null,
        is_active: true,
        sync_status: "active",
        last_sync_at: new Date().toISOString(),
        metadata: {
          connected_at: new Date().toISOString(),
          provider: platform === "bndv" ? "BNDV" : platform,
          api_url: platform === "bndv" ? BNDV_API_URL : undefined,
        },
      };

      const { data, error } = await adminClient
        .from("platform_integrations")
        .upsert(integrationPayload, { onConflict: "user_id,platform" })
        .select()
        .single();

      if (error) {
        const { data: insertData, error: insertError } = await adminClient
          .from("platform_integrations")
          .insert(integrationPayload)
          .select()
          .single();

        if (insertError) {
          return new Response(JSON.stringify({ error: insertError.message }), {
            status: 400,
            headers: corsHeaders,
          });
        }

        return new Response(JSON.stringify({ success: true, integration: insertData }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, integration: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "disconnect") {
      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      await adminClient
        .from("platform_integrations")
        .update({ is_active: false, sync_status: "disconnected" })
        .eq("user_id", userId)
        .eq("platform", platform);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let result;
    switch (platform) {
      case "ga4":
        result = await testGA4(credentials);
        break;
      case "hotmart":
        result = await testHotmart(credentials);
        break;
      case "zapier":
      case "webhook":
        result = await testWebhook(credentials);
        break;
      case "google_sheets":
        result = await testGoogleSheets(credentials);
        break;
      case "bndv":
        result = await testBndv(credentials);
        break;
      case "google_calendar":
        result = await testGoogleCalendar(credentials);
        break;
      default:
        result = { success: false, message: "Plataforma não suportada" };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
