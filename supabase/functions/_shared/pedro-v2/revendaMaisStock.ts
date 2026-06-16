// revendaMaisStock.ts — adaptador de estoque RevendaMais (feed JSON da loja).
//
// Cliente SEM BNDV (ex.: Avant Motors Taubate) expoe o estoque por um feed JSON publico
// (RevendaMais/carro57). Este modulo BAIXA o feed (cache curto) e NORMALIZA cada veiculo
// pro MESMO shape interno que o motor ja usa (BndvVehicle), pra reaproveitar TODO o
// pipeline existente — rankVehicles/scoreVehicle/grounding/fotos — sem mudanca.
//
// Decisao de design: o feed e um DUMP da loja inteira. Buscamos tudo e filtramos do nosso
// lado (o motor ja faz scoring/filtros). Cache de ~10min evita refetch a cada turno sem
// ficar stale (o feed atualiza a cada poucos minutos; tem file_date/last_update).

type RawRevendaVehicle = Record<string, any>;

// Shape interno consumido pelo motor (igual ao BNDV). Mantido aqui solto (o motor o tipa).
export type NormalizedVehicle = {
  markName: string | null;
  modelName: string | null;
  versionName: string | null;
  year: number | null;
  km: number | null;
  saleValue: number | null;
  color: string | null;
  fuelName: string | null;
  transmissionName: string | null;
  pictureJs: string | null;
  // Categoria crua do feed (AUTOMOVEL/MOTO/...). Sinal AUTORITATIVO de moto pro motor
  // (isLikelyMotorcycle) — pega ex.: Honda CB 500F sem depender de regex de texto.
  category: string | null;
};

// Cache em memoria por URL. Isolates do edge sao efemeros -> best-effort (ajuda enquanto quente).
const _cache = new Map<string, { at: number; vehicles: NormalizedVehicle[] }>();
const TTL_MS = 10 * 60 * 1000;

function num(value: any): number | null {
  const n = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// versionName = model SEM o base_model duplicado + motorizacao. O cleanVehicleLabel do motor
// ja remove duplicidade, mas montamos limpo pra matching/score ficarem bons.
function buildVersion(raw: RawRevendaVehicle): string {
  const base = String(raw.base_model || "").trim();
  const model = String(raw.model || "").trim();
  const motor = String(raw.motorization || "").trim();
  let version = model;
  if (base && model.toUpperCase().startsWith(base.toUpperCase())) {
    version = model.slice(base.length).trim();
  }
  // evita repetir o motor se ja estiver no texto do modelo (ex.: "1.0" em "ONIX 1.0")
  const hasMotor = motor && version.replace(/\s+/g, "").includes(motor.replace(/\s+/g, ""));
  return [version, hasMotor ? "" : motor].filter(Boolean).join(" ").trim();
}

// O motor le as fotos de pictureJs = JSON string de [{Link, Principal}] (parseBndvPictures).
function toPictureJs(raw: RawRevendaVehicle): string | null {
  const imgs: any[] = Array.isArray(raw.images_large) && raw.images_large.length
    ? raw.images_large
    : (Array.isArray(raw.images) ? raw.images : []);
  const urls = imgs.map((u) => String(u || "").trim()).filter(Boolean);
  if (!urls.length) return null;
  return JSON.stringify(urls.map((url, i) => ({ Link: url, Principal: i === 0 ? "true" : "false" })));
}

export function revendaMaisToNormalized(raw: RawRevendaVehicle): NormalizedVehicle {
  // preco: usa promotion_price se > 0 (promocao real), senao price. Sem preco -> null
  // (o motor sinaliza preco_a_confirmar, NUNCA mostra R$0 nem nega o carro).
  const price = num(raw.promotion_price) ?? num(raw.price);
  return {
    markName: raw.make ? String(raw.make).trim() : null,
    modelName: raw.base_model
      ? String(raw.base_model).trim()
      : (String(raw.model || "").trim().split(/\s+/)[0] || null),
    versionName: buildVersion(raw) || null,
    year: Number(raw.year) || Number(raw.fabric_year) || null,
    km: num(raw.mileage),
    saleValue: price,
    color: raw.color ? String(raw.color).trim() : null,
    fuelName: raw.fuel ? String(raw.fuel).trim() : null,
    transmissionName: raw.gear ? String(raw.gear).trim() : null,
    pictureJs: toPictureJs(raw),
    category: raw.category ? String(raw.category).trim() : null,
  };
}

// Baixa o feed (cacheado) e devolve os veiculos JA normalizados pro shape do motor.
// Lanca em falha de rede/parse -> o chamador (searchPedroStock) trata e devolve erro limpo.
export async function fetchRevendaMaisVehicles(feedUrl: string): Promise<NormalizedVehicle[]> {
  const cached = _cache.get(feedUrl);
  const now = Date.now();
  if (cached && (now - cached.at) < TTL_MS) return cached.vehicles;

  const res = await fetch(feedUrl, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`feed status ${res.status}`);
  const json = await res.json();
  const rawList = Array.isArray(json?.vehicles)
    ? json.vehicles
    : (Array.isArray(json) ? json : []);
  // NAO filtramos moto aqui: a categoria e preservada e o MOTOR decide por agente
  // (sells_motorcycles). Assim o mesmo feed serve loja so-carro E loja que vende moto.
  const vehicles = rawList
    .map(revendaMaisToNormalized)
    // descarta lixo sem marca/modelo (nao da pra casar nem apresentar)
    .filter((v: NormalizedVehicle) => v.markName || v.modelName);

  _cache.set(feedUrl, { at: now, vehicles });
  return vehicles;
}
