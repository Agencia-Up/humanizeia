const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function buildAdminHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    apikey: apiKey,
    token: apiKey,
    admintoken: apiKey,
    Authorization: `Bearer ${apiKey}`,
  };
}

Deno.serve(async (req) => {
  console.log(`[test-uazapi-connection] Received ${req.method} request`);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const legacyUazapiToken = Deno.env.get("UAZAPI_API") || Deno.env.get("UAZAPI-API");
    const apiUrl =
      Deno.env.get("UAZAPI_URL") ||
      Deno.env.get("EVOLUTION_API_URL") ||
      (legacyUazapiToken ? "https://logosiabrasilcom.uazapi.com" : "");
    const apiKey =
      Deno.env.get("UAZAPI_ADMIN_TOKEN") ||
      legacyUazapiToken ||
      Deno.env.get("EVOLUTION_API_KEY");

    if (!apiUrl || !apiKey) {
      return new Response(JSON.stringify({
        success: false,
        error: "UaZapi nao configurada no servidor. Contate o administrador.",
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = apiUrl.replace(/\/$/, "");
    const headers = buildAdminHeaders(apiKey);
    const attemptedEndpoints = ["/instance/all", "/instance/list", "/instance/fetchInstances"];
    let response: Response | null = null;
    let responseText = "";

    for (const endpoint of attemptedEndpoints) {
      const fetchUrl = `${baseUrl}${endpoint}`;
      console.log(`[test-uazapi-connection] Health check: ${fetchUrl}`);
      response = await fetch(fetchUrl, { method: "GET", headers });
      responseText = await response.text();
      if (response.ok || response.status === 401 || response.status === 403) break;
    }

    console.log(`[test-uazapi-connection] Status: ${response?.status}`);

    if (response?.status === 401 || response?.status === 403) {
      return new Response(JSON.stringify({
        success: false,
        error: "API Key invalida ou sem permissao.",
        status: response.status,
        attempted_endpoints: attemptedEndpoints,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (response?.ok) {
      let parsed: unknown = null;
      try { parsed = JSON.parse(responseText); } catch {}
      const instances = Array.isArray(parsed) ? parsed : (Array.isArray((parsed as any)?.instances) ? (parsed as any).instances : []);

      return new Response(JSON.stringify({
        success: true,
        connected: true,
        instances_count: instances.length,
        message: "UaZapi acessivel.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: false,
      error: `Servidor retornou status ${response?.status || "desconhecido"}.`,
      status: response?.status || null,
      attempted_endpoints: attemptedEndpoints,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("[test-uazapi-connection] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({
      success: false,
      error: `Nao foi possivel alcancar o servidor: ${message}`,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
