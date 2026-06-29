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
