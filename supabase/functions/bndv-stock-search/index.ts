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
  let normalized = (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/-/g, ' ')
    .replace(/[^\w\s.]/g, ' ')
    .trim();

  normalized = normalized
    .replace(/\beco\s*sport\b/g, 'ecosport')
    .replace(/\bfree\s*style\b/g, 'freestyle')
    .replace(/\bprem\.\b/g, 'premier')
    .replace(/\bpremi\b/g, 'premier')
    .replace(/\bcresta\b/g, 'creta')
    .replace(/\bh rv\b/g, 'hrv')
    .replace(/\bt-cross\b/g, 'tcross')
    .replace(/\bt\s+cross\b/g, 'tcross')
    .replace(/\bonix\s+plus\s+sedan\b/g, 'onix sedan plus')
    .replace(/\bonix\s+plus\b/g, 'onix sedan plus')
    .replace(/\s+/g, ' ');

  const expansions: string[] = [];
  if (/\bonix\b/.test(normalized)) expansions.push('chevrolet onix hatch sedan plus joy premier lt ltz activ');
  if (/\bonix\b/.test(normalized) && /\bsedan\b/.test(normalized)) expansions.push('onix plus');
  if (/\bcreta\b/.test(normalized)) expansions.push('hyundai creta action comfort limited platinum ultimate');
  if (/\becosport\b/.test(normalized)) expansions.push('ford ecosport freestyle titanium se');
  if (/\bargo\b/.test(normalized)) expansions.push('fiat argo drive trekking');
  if (/\btracker\b/.test(normalized)) expansions.push('chevrolet tracker premier ltz lt');
  if (expansions.length > 0) normalized = `${normalized} ${expansions.join(' ')}`;

  return normalized;
}

const WEAK_WORDS = new Set([
  'carro', 'veiculo', 'veiculos', 'revisado', 'revisados', 'pronto', 'prontos',
  'para', 'por', 'apenas', 'oferta', 'anuncio', 'facebook', 'instagram', 'fale',
  'agora', 'consultor', 'consultores', 'opcoes', 'disponiveis', 'disponivel',
  'informacoes', 'interesse', 'queria', 'mais', 'favor', 'preco', 'valor',
  'automatico', 'manual', 'flex', 'gasolina', 'diesel', 'alcool', 'aut',
  'mec', 'mecanico', 'motors', 'icom', 'loja', 'estoque', 'ltda', 'porfavor',
  'lead', 'clicou', 'link', 'meta', 'whatsapp', 'identificado', 'imagem', 'thumbnail',
  'url', 'texto', 'de', 'da', 'do', 'dos', 'das', 'um', 'uma', 'com', 'sem',
]);

function searchTokens(value?: string | null) {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !WEAK_WORDS.has(token));
}

function levenshteinDistance(left: string, right: string) {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i++) {
    current[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    for (let j = 0; j <= right.length; j++) previous[j] = current[j];
  }

  return previous[right.length];
}

function tokenSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length <= 3 || right.length <= 3) return 0;
  return 1 - (levenshteinDistance(left, right) / Math.max(left.length, right.length));
}

function buildIndexedText(vehicle: BndvVehicle) {
  let indexed = normalizeText([
    vehicle.markName,
    vehicle.modelName,
    vehicle.versionName,
    vehicle.color,
    vehicle.fuelName,
    vehicle.transmissionName,
    vehicle.year?.toString(),
  ].filter(Boolean).join(' '));

  if (/\b(hilux|s10|ranger|amarok|toro|frontier|triton|l200|strada|saveiro|montana|oroch|maverick|ram|1500|2500|3500|f150|silverado|titano|poer|gladiator|d20|f1000)\b/i.test(indexed)) indexed += ' picape caminhonete camionete pickup';
  if (/\b(compass|renegade|creta|kicks|hrv|corolla cross|tracker|tcross|nivus|fastback|pulse|tiggo|sw4|equinox|commander|taos|ecosport|duster|kardian|outlander|pajero|xc60|xc40)\b/i.test(indexed)) indexed += ' suv utilitario';
  if (/\b(corolla|civic|cruze|jetta|virtus|cronos|versa|hb20s|yaris sedan|logan|city|sentra|cerato|fusion)\b/i.test(indexed)) indexed += ' sedan';
  if (/\b(onix|hb20|polo|argo|208|yaris|mobi|kwid|c3|gol|fox|sandero|up|fiesta|march)\b/i.test(indexed)) indexed += ' hatch popular';

  return indexed;
}

function buildSearchText(filters: any) {
  return normalizeText([
    filters?.query,
    filters?.ad_context,
    filters?.contexto_anuncio,
    filters?.marca,
    filters?.modelo,
    filters?.versao,
    filters?.cor,
    filters?.combustivel,
    filters?.cambio,
    filters?.ano_min && filters?.ano_min === filters?.ano_max ? String(filters.ano_min) : '',
  ].filter(Boolean).join(' '));
}

function scoreVehicle(vehicle: BndvVehicle, filters: any) {
  const searchText = buildSearchText(filters);
  if (!searchText) return { score: 1, matchedTokens: [] as string[] };

  const indexed = buildIndexedText(vehicle);
  const indexedTokens = searchTokens(indexed);
  const queryTokens = [...new Set(searchTokens(searchText))];
  const matchedTokens: string[] = [];
  let score = 0;

  for (const token of queryTokens) {
    if (indexed.includes(token)) {
      matchedTokens.push(token);
      score += token.length <= 3 ? 1 : 2;
      continue;
    }
    if (indexedTokens.some((candidate) => tokenSimilarity(candidate, token) >= 0.84)) {
      matchedTokens.push(token);
      score += 1.25;
    }
  }

  const model = normalizeText(vehicle.modelName);
  const version = normalizeText(vehicle.versionName);
  const mark = normalizeText(vehicle.markName);
  const year = String(vehicle.year || '');

  if (filters?.marca && mark.includes(normalizeText(filters.marca))) score += 4;
  if (filters?.modelo && (model.includes(normalizeText(filters.modelo)) || indexed.includes(normalizeText(filters.modelo)))) score += 7;
  if (filters?.versao && version.includes(normalizeText(filters.versao))) score += 4;
  if (year && searchText.includes(year)) score += 3;

  if (searchText.includes('onix') && model.includes('onix')) score += 10;
  if (searchText.includes('onix') && searchText.includes('sedan') && (model.includes('sed') || version.includes('sed') || model.includes('plus') || version.includes('plus'))) score += 8;
  if (searchText.includes('onix') && searchText.includes('plus') && (model.includes('plus') || version.includes('plus') || model.includes('sed'))) score += 6;
  if (searchText.includes('premier') && (version.includes('premier') || version.includes('prem'))) score += 4;
  if (searchText.includes('ecosport') && model.includes('ecosport')) score += 10;
  if (searchText.includes('creta') && model.includes('creta')) score += 10;

  for (const modelToken of searchTokens(model)) {
    if (queryTokens.includes(modelToken)) score += 5;
  }

  if (searchText.includes('creta') && model.includes('tiggo')) score -= 5;
  if (searchText.includes('onix') && !model.includes('onix')) score -= 8;
  if (searchText.includes('ecosport') && !model.includes('ecosport')) score -= 8;
  if (searchText.includes('creta') && !model.includes('creta')) score -= 8;

  const requiredTokens = Math.min(2, queryTokens.length);
  if (queryTokens.length > 0 && matchedTokens.length < requiredTokens && score < 5) score = 0;

  return { score, matchedTokens };
}

function passesNumericFilters(vehicle: BndvVehicle, filters: any, relaxed = false) {
  if (relaxed) return true;
  const year = Number(vehicle.year || 0);
  const price = Number(vehicle.saleValue || 0);
  const mileage = Number(vehicle.km || 0);

  return (
    (!filters?.ano_min || year >= Number(filters.ano_min)) &&
    (!filters?.ano_max || year <= Number(filters.ano_max)) &&
    (!filters?.preco_max || price <= Number(filters.preco_max)) &&
    (!filters?.km_max || mileage <= Number(filters.km_max))
  );
}

function rankVehicles(vehicles: BndvVehicle[], filters: any) {
  const hasSearch = !!buildSearchText(filters);
  if (!hasSearch) {
    return [...vehicles]
      .filter((vehicle) => passesNumericFilters(vehicle, filters))
      .map((vehicle) => ({ vehicle, score: 1, matchedTokens: [] as string[], relaxed: false }));
  }

  const ranked = vehicles
    .map((vehicle) => ({ vehicle, ...scoreVehicle(vehicle, filters), relaxed: false }))
    .filter((item) => item.score > 0 && passesNumericFilters(item.vehicle, filters))
    .sort((left, right) => right.score - left.score);

  if (ranked.length > 0) return ranked;

  return vehicles
    .map((vehicle) => ({ vehicle, ...scoreVehicle(vehicle, filters), relaxed: true }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
}

function sortRankedVehicles(items: Array<{ vehicle: BndvVehicle; score: number; matchedTokens: string[]; relaxed: boolean }>) {
  return [...items].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftPrice = Number(left.vehicle.saleValue || 0);
    const rightPrice = Number(right.vehicle.saleValue || 0);
    if (leftPrice !== rightPrice) return leftPrice - rightPrice;
    return Number(right.vehicle.year || 0) - Number(left.vehicle.year || 0);
  });
}

function parseBndvPictures(rawPictureJs?: string | null) {
  if (!rawPictureJs) return [];

  try {
    const parsed = JSON.parse(rawPictureJs);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item: any) => ({
        url: String(item?.Link || item?.link || '').trim(),
        principal: String(item?.Principal || item?.principal || '').toLowerCase() === 'true',
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

    const ranked = sortRankedVehicles(rankVehicles(vehicles, body || {}));
    const filtered = ranked.map((item) => ({
      ...item.vehicle,
      __bndv_score: item.score,
      __bndv_matched_tokens: item.matchedTokens,
      __bndv_relaxed_match: item.relaxed,
    }));

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
            match_score: (vehicle as any).__bndv_score || null,
            relaxed_match: !!(vehicle as any).__bndv_relaxed_match,
          };
        }),
        response_guidance: filtered.length > 0
          ? "Ha candidatos compativeis no estoque. Nao trate como indisponivel; se nao for 100% exato, apresente como opcao provavel/proxima e confirme os detalhes."
          : "Nenhum candidato compativel encontrado mesmo com busca ampla.",
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
