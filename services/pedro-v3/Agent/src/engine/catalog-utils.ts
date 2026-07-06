// ============================================================================
// Helpers de catÃ¡logo puros e seguros. Fase 1.5.
// ============================================================================
import type { TenantCatalog, CatalogEntry } from "../domain/decision.ts";

/**
 * Escapa caracteres especiais de regex em uma string.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[/\-\\^$*+?.()|[\]{}]/g, "\\$&");
}

/**
 * Normaliza texto para comparacao canonica de catalogo.
 * Hifen/pontuacao viram separadores, acentos sao removidos e "+" e preservado
 * semanticamente como "plus" para nao transformar "C++" em uma letra solta.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\+/g, " plus ")
    .replace(/&/g, " e ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// \u2500\u2500 Identidade CAN\u00d4NICA de MODELO (fonte \u00daNICA, usada por grounding E TurnUnderstanding). Normaliza S\u00d3 formata\u00e7\u00e3o
//    (caixa/acento/espa\u00e7o/h\u00edfen/pontua\u00e7\u00e3o \u2014 normalizeText j\u00e1 faz) e PRESERVA tokens sem\u00e2nticos (Plus/S/Aircross/Sedan/
//    Cross/Sport). Compara\u00e7\u00e3o \u00e9 por IGUALDADE EXATA, NUNCA substring: "hb 20"=="hb20" mas "hb20"!="hb20s"; "onix"!=
//    "onix plus"; "c3"!="c3 aircross"; "cr-v"=="crv". Aliases reais = cat\u00e1logo/taxonomia, jamais includes. \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
export function canonicalModel(m: string): string {
  return normalizeText(m).replace(/[\s-]+/g, "");
}
// Um modelo CITADO (bare "Onix" OU marca+modelo "Chevrolet Onix") tem a MESMA identidade de um ve\u00edculo estruturado?
// Igualdade can\u00f4nica EXATA contra `modelo` e contra `marca modelo`. Sem `modelo` estruturado confi\u00e1vel -> nunca casa.
export function modelIdentityMatches(subjectRaw: string, veh: { readonly marca: string | null; readonly modelo: string | null }): boolean {
  if (!veh.modelo) return false;
  const s = canonicalModel(subjectRaw);
  if (!s) return false;
  if (s === canonicalModel(veh.modelo)) return true;
  return veh.marca != null && s === canonicalModel(`${veh.marca} ${veh.modelo}`);
}

export function normalizedTermInText(text: string, term: string): boolean {
  const normalizedTerm = normalizeText(term);
  if (!normalizedTerm) return false;
  const normalizedText = ` ${normalizeText(text)} `;
  return normalizedText.includes(` ${normalizedTerm} `);
}

/**
 * Extrai todas as marcas e modelos Ãºnicos (em minÃºsculas) do catÃ¡logo.
 */
export function getCatalogBrandsAndModels(catalog: TenantCatalog): { brands: Set<string>; models: Set<string> } {
  const brands = new Set<string>();
  const models = new Set<string>();

  for (const entry of catalog.entries) {
    brands.add(normalizeText(entry.brand));
    models.add(normalizeText(entry.model));
    // TambÃ©m adicionamos os aliases como modelos vÃ¡lidos de correspondÃªncia
    for (const alias of entry.aliases) {
      models.add(normalizeText(alias));
    }
  }

  return { brands, models };
}

/**
 * Verifica se uma chave de veÃ­culo (ou seus componentes) Ã© permitida pelo catÃ¡logo.
 */
export function isVehicleKeyInCatalog(catalog: TenantCatalog, vehicleKey: string): boolean {
  const direct = catalog.entries.some((entry) => entry.vehicleKey === vehicleKey);
  if (direct) return true;

  // Compatibilidade com chaves legadas de testes/rascunhos: brand|model|year.
  // O formato real do read-side e provider:id; ele precisa ser validado por match exato.
  const parts = vehicleKey.split("|");
  const brand = parts[0];
  const model = parts[1];
  if (!brand || !model) return false;

  const normBrand = normalizeText(brand);
  const normModel = normalizeText(model);

  return catalog.entries.some((entry) => {
    const entryBrand = normalizeText(entry.brand);
    const entryModel = normalizeText(entry.model);
    const hasAliasMatch = entry.aliases.some((alias) => normalizeText(alias) === normModel);

    return entryBrand === normBrand && (entryModel === normModel || hasAliasMatch);
  });
}

import type { VehicleFact } from "../domain/types.ts";

/**
 * Constrói dinamicamente o TenantCatalog a partir da lista de VehicleFacts vivos do estoque.
 * Garante zero marcas ou modelos hardcoded.
 */
export function buildTenantCatalog(facts: readonly VehicleFact[]): TenantCatalog {
  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();

  for (const fact of facts) {
    if (seen.has(fact.vehicleKey)) continue;
    seen.add(fact.vehicleKey);

    entries.push({
      vehicleKey: fact.vehicleKey,
      brand: fact.marca,
      model: fact.modelo,
      aliases: [
        fact.modelo,
        `${fact.marca} ${fact.modelo}`
      ]
    });
  }

  return { entries };
}
