import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BNDV_API_URL = "https://api-estoque.azurewebsites.net/graphql";
const DEFAULT_LIMIT = 12;

interface BndvCredentials {
  api_token?: string;
}

interface BndvVehicle {
  modelName?: string | null;
  markName?: string | null;
  year?: number | null;
  km?: number | null;
  saleValue?: number | null;
  color?: string | null;
  fuelName?: string | null;
  transmissionName?: string | null;
  versionName?: string | null;
  pictureJs?: string | null;
}

async function getAuthenticatedUserId(req: Request) {
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

function parseCredentials(raw: string | null): BndvCredentials {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    return { api_token: raw };
  }

  return {};
}

function normalizeText(value?: string | null) {
  return (value || "").toLowerCase().trim();
}

function matchesIncludes(haystack: string | null | undefined, needle?: string | null) {
  if (!needle?.trim()) return true;
  return normalizeText(haystack).includes(normalizeText(needle));
}

function matchesQuery(vehicle: BndvVehicle, query?: string | null) {
  if (!query?.trim()) return true;

  const indexed = [
    vehicle.markName,
    vehicle.modelName,
    vehicle.versionName,
    vehicle.color,
    vehicle.fuelName,
    vehicle.transmissionName,
    vehicle.year?.toString(),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return indexed.includes(normalizeText(query));
}

function sortVehicles(vehicles: BndvVehicle[]) {
  return [...vehicles].sort((left, right) => {
    const leftPrice = Number(left.saleValue || 0);
    const rightPrice = Number(right.saleValue || 0);
    if (leftPrice !== rightPrice) return leftPrice - rightPrice;

    const leftYear = Number(left.year || 0);
    const rightYear = Number(right.year || 0);
    return rightYear - leftYear;
  });
}

function parseBndvPictures(rawPictureJs?: string | null) {
  if (!rawPictureJs) return [];

  try {
    const parsed = JSON.parse(rawPictureJs);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item: any) => ({
        url: String(item?.Link || item?.link || "").trim(),
        principal: String(item?.Principal || item?.principal || "").toLowerCase() === "true",
      }))
      .filter((item: any) => !!item.url)
      .sort((left: any, right: any) => Number(right.principal) - Number(left.principal));
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const {
      query,
      marca,
      modelo,
      versao,
      combustivel,
      cambio,
      cor,
      ano_min,
      ano_max,
      preco_max,
      km_max,
      limite,
    } = body || {};

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: integration, error: integrationError } = await adminClient
      .from("platform_integrations")
      .select("api_key_encrypted, is_active")
      .eq("user_id", userId)
      .eq("platform", "bndv")
      .maybeSingle();

    if (integrationError) {
      throw integrationError;
    }

    if (!integration?.is_active) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Integração BNDV não conectada para este cliente.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const credentials = parseCredentials(integration.api_key_encrypted);
    const token = credentials.api_token?.trim();

    if (!token) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Bearer Token do BNDV não encontrado na integração salva.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const graphqlResponse = await fetch(BNDV_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: `
          query BndvVehicles {
            vehiclesBy {
              modelName
              markName
              year
              km
              saleValue
              color
              fuelName
              transmissionName
              versionName
              pictureJs
            }
          }
        `,
      }),
    });

    const payload = await graphqlResponse.json().catch(() => null);

    if (!graphqlResponse.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            payload?.errors?.[0]?.message ||
            payload?.message ||
            `BNDV retornou status ${graphqlResponse.status}.`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: payload.errors[0]?.message || "A API do BNDV retornou um erro.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const vehicles = Array.isArray(payload?.data?.vehiclesBy) ? payload.data.vehiclesBy : [];

    const filtered = sortVehicles(
      vehicles.filter((vehicle: BndvVehicle) => {
        const year = Number(vehicle.year || 0);
        const price = Number(vehicle.saleValue || 0);
        const mileage = Number(vehicle.km || 0);

        return (
          matchesQuery(vehicle, query) &&
          matchesIncludes(vehicle.markName, marca) &&
          matchesIncludes(vehicle.modelName, modelo) &&
          matchesIncludes(vehicle.versionName, versao) &&
          matchesIncludes(vehicle.fuelName, combustivel) &&
          matchesIncludes(vehicle.transmissionName, cambio) &&
          matchesIncludes(vehicle.color, cor) &&
          (!ano_min || year >= Number(ano_min)) &&
          (!ano_max || year <= Number(ano_max)) &&
          (!preco_max || price <= Number(preco_max)) &&
          (!km_max || mileage <= Number(km_max))
        );
      })
    );

    const limited = filtered.slice(0, Number(limite || DEFAULT_LIMIT));

    return new Response(
      JSON.stringify({
        success: true,
        total: filtered.length,
        items: limited.map((vehicle: BndvVehicle) => {
          const pictures = parseBndvPictures(vehicle.pictureJs);
          const principalImage = pictures.find((item: any) => item.principal)?.url || pictures[0]?.url || null;

          return {
            marca: vehicle.markName || null,
            modelo: vehicle.modelName || null,
            versao: vehicle.versionName || null,
            ano: vehicle.year || null,
            km: vehicle.km || null,
            preco: vehicle.saleValue || null,
            cor: vehicle.color || null,
            combustivel: vehicle.fuelName || null,
            cambio: vehicle.transmissionName || null,
            label: [vehicle.markName, vehicle.modelName, vehicle.versionName].filter(Boolean).join(" "),
            principal_image: principalImage,
            images_count: pictures.length,
          };
        }),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || "Erro inesperado ao consultar o estoque BNDV.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
