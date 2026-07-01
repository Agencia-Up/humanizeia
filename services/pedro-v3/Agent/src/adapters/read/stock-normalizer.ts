import * as crypto from "crypto";
import type { NormalizedVehicle, StockProvider, TypedVehicleType } from "../../domain/read-ports.ts";
import type { VehicleType } from "../../domain/types.ts";

export function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/-/g, " ")
    .replace(/[^\w\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyVehicleType(
  sourceCategory: string | null,
  sourceBodyType: string | null,
  sourceProvider?: string | null,
): TypedVehicleType {
  const categoryNorm = normalizeText(sourceCategory);
  const bodyTypeNorm = normalizeText(sourceBodyType);

  const checkSource = (txt: string): VehicleType | null => {
    if (/\b(suv)\b/.test(txt)) return "suv";
    if (/\b(pickup|picape|pick\s*up)\b/.test(txt)) return "pickup";
    if (/\b(sedan|seda)\b/.test(txt)) return "sedan";
    if (/\b(hatch|hatchback)\b/.test(txt)) return "hatch";
    return null;
  };

  // RevendaMais usa `utilitario` como a carroceria de suas picapes no feed.
  // A regra e escopada ao provedor e ao campo factual; nao depende de lista de modelos.
  if (sourceProvider === "revendamais" && bodyTypeNorm === "utilitario") {
    return { value: "pickup", confidence: 1.0, provenance: "source_field" };
  }
  const fromBodyType = checkSource(bodyTypeNorm);
  if (fromBodyType) return { value: fromBodyType, confidence: 1.0, provenance: "source_field" };

  const fromCategory = checkSource(categoryNorm);
  if (fromCategory) return { value: fromCategory, confidence: 1.0, provenance: "source_field" };

  return { value: "unknown", confidence: 0.0, provenance: "unknown" };
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("VEHICLE_DECODE_FAILED: payload is not an object");
  }
  return raw as Record<string, unknown>;
}

function pick(obj: Record<string, unknown>, names: readonly string[]): unknown {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(obj, name)) {
      return obj[name];
    }
  }
  return undefined;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`VEHICLE_DECODE_FAILED: ${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function requiredString(value: unknown, field: string): string {
  const parsed = optionalString(value, field);
  if (!parsed) {
    throw new Error(`VEHICLE_DECODE_FAILED: missing ${field}`);
  }
  return parsed;
}

function optionalExternalId(value: unknown, field: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new Error(`VEHICLE_DECODE_FAILED: ${field} must be a scalar id`);
}

function parseFlexibleNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(/r\$/gi, "").replace(/\s+/g, "");
  if (!cleaned) return null;
  if (!/^[+-]?[\d.,]+$/.test(cleaned)) return null;

  let normalized = cleaned;
  const hasDot = normalized.includes(".");
  const hasComma = normalized.includes(",");

  if (hasDot && hasComma) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    const [, decimal = ""] = normalized.split(",");
    normalized = decimal.length === 3 ? normalized.replace(/,/g, "") : normalized.replace(",", ".");
  } else if (hasDot) {
    const parts = normalized.split(".");
    const last = parts[parts.length - 1] ?? "";
    normalized = last.length === 3 ? normalized.replace(/\./g, "") : normalized;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`VEHICLE_DECODE_FAILED: ${field} must be finite`);
    return value;
  }
  if (typeof value === "string") {
    const parsed = parseFlexibleNumber(value);
    if (parsed === null) throw new Error(`VEHICLE_DECODE_FAILED: ${field} must be numeric`);
    return parsed;
  }
  throw new Error(`VEHICLE_DECODE_FAILED: ${field} must be numeric`);
}

function optionalYear(value: unknown): number | null {
  const parsed = optionalNumber(value, "year");
  if (parsed === null) return null;
  if (!Number.isInteger(parsed) || parsed <= 1900 || parsed >= 2100) {
    throw new Error("VEHICLE_DECODE_FAILED: year out of range");
  }
  return parsed;
}

function optionalNonNegativeNumber(value: unknown, field: string): number | null {
  const parsed = optionalNumber(value, field);
  if (parsed === null) return null;
  if (parsed < 0) throw new Error(`VEHICLE_DECODE_FAILED: ${field} must be non-negative`);
  return parsed;
}

function firstPositiveNumber(values: readonly unknown[]): number | null {
  let sawZero = false;
  for (const value of values) {
    const parsed = optionalNonNegativeNumber(value, "price");
    if (parsed !== null && parsed > 0) return parsed;
    if (parsed === 0) sawZero = true;
  }
  return sawZero ? 0 : null;
}

function stringifyPictureArray(items: readonly unknown[]): string | null {
  const mapped = items.flatMap((img, idx) => {
    let url: string | null = null;
    if (typeof img === "string") {
      url = img.trim();
    } else if (typeof img === "object" && img !== null && !Array.isArray(img)) {
      const rec = img as Record<string, unknown>;
      const rawUrl = rec.Link ?? rec.link;
      if (typeof rawUrl === "string") url = rawUrl.trim();
    }
    if (!url) return [];
    return [{ Link: url, Principal: idx === 0 ? "true" : "false" }];
  });
  return mapped.length > 0 ? JSON.stringify(mapped) : null;
}

export function decodeNormalizedVehicle(raw: unknown, source: StockProvider): NormalizedVehicle {
  const obj = asRecord(raw);

  const externalVehicleId = source === "revendamais"
    ? optionalExternalId(pick(obj, ["vehicle_id"]), "vehicle_id")
    : optionalExternalId(pick(obj, ["vehicleExternalKey"]), "vehicleExternalKey");

  const markName = requiredString(pick(obj, ["make", "markName"]), "markName");
  const modelName = requiredString(pick(obj, ["base_model", "modelName"]), "modelName");
  const versionName = optionalString(pick(obj, ["model", "versionName"]), "versionName");
  const year = optionalYear(pick(obj, ["year", "fabric_year"]));
  const km = optionalNonNegativeNumber(pick(obj, ["mileage", "km"]), "km");
  const saleValue = firstPositiveNumber([
    pick(obj, ["promotion_price"]),
    pick(obj, ["price"]),
    pick(obj, ["saleValue"])
  ]);
  const color = optionalString(pick(obj, ["color"]), "color");
  const fuelName = optionalString(pick(obj, ["fuel", "fuelName"]), "fuelName");
  const transmissionName = optionalString(pick(obj, ["gear", "transmissionName"]), "transmissionName");
  const category = optionalString(pick(obj, ["category"]), "category");
  const bodyType = optionalString(pick(obj, ["body_type", "subCategoryName"]), "bodyType");

  let pictureJs: string | null = null;
  const rawPictureJs = pick(obj, ["pictureJs"]);
  if (rawPictureJs !== undefined && rawPictureJs !== null) {
    if (typeof rawPictureJs !== "string") {
      throw new Error("VEHICLE_DECODE_FAILED: pictureJs must be a string");
    }
    const pStr = rawPictureJs.trim();
    try {
      const parsed = JSON.parse(pStr);
      if (Array.isArray(parsed)) {
        pictureJs = pStr;
      }
    } catch {
      pictureJs = null;
    }
  }

  if (!pictureJs) {
    const rawImages = pick(obj, ["images_large", "images", "images_small"]);
    if (rawImages !== undefined && rawImages !== null) {
      if (!Array.isArray(rawImages)) {
        throw new Error("VEHICLE_DECODE_FAILED: images must be an array");
      }
      pictureJs = stringifyPictureArray(rawImages);
    }
  }

  return {
    source,
    externalVehicleId,
    markName,
    modelName,
    versionName,
    year,
    km,
    saleValue,
    color,
    fuelName,
    transmissionName,
    pictureJs,
    category,
    bodyType
  };
}

export function generateVehicleKey(v: NormalizedVehicle): { key: string; fingerprintUsed: boolean } {
  const source = v.source || "unknown";
  if (v.externalVehicleId) {
    return { key: `${source}:${v.externalVehicleId}`, fingerprintUsed: false };
  }

  const rawFingerprint = [
    v.markName,
    v.modelName,
    v.versionName,
    v.year !== null && v.year !== undefined ? String(v.year) : null,
    v.color,
    v.fuelName,
    v.transmissionName
  ]
    .map(val => normalizeText(val))
    .join("|");

  const hash = crypto.createHash("sha256").update(rawFingerprint).digest("hex").slice(0, 16);
  return { key: `${source}:fp-${hash}`, fingerprintUsed: true };
}

const ALLOWED_PHOTO_HOSTS = new Set([
  "s3.carro57.com.br",
  "bndvsistemalojistasst.blob.core.windows.net",
  "app.revendamais.com.br"
]);

export function isValidPhotoUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== "https:") return false;
    return ALLOWED_PHOTO_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function generatePhotoId(vehicleKey: string, url: string): string {
  if (!isValidPhotoUrl(url)) {
    throw new Error("INVALID_PHOTO_URL");
  }
  const urlObj = new URL(url);
  const path = urlObj.pathname.toLowerCase();
  const hash = crypto.createHash("sha256").update(path).digest("hex").slice(0, 16);
  return `${vehicleKey}:ph-${hash}`;
}

export type PhotoMapping = {
  readonly id: string;
  readonly url: string;
  readonly isPrincipal: boolean;
};

export function parseVehiclePhotos(vehicleKey: string, pictureJs: string | null): PhotoMapping[] {
  if (!pictureJs) return [];
  try {
    const parsed = JSON.parse(pictureJs);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item: unknown) => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
        const rec = item as Record<string, unknown>;
        const rawUrl = rec.Link ?? rec.link;
        if (typeof rawUrl !== "string") return null;
        const url = rawUrl.trim();
        const rawPrincipal = rec.Principal ?? rec.principal;
        const isPrincipal = typeof rawPrincipal === "boolean"
          ? rawPrincipal
          : typeof rawPrincipal === "string" && rawPrincipal.toLowerCase() === "true";
        if (!url || !isValidPhotoUrl(url)) return null;
        return {
          id: generatePhotoId(vehicleKey, url),
          url,
          isPrincipal
        };
      })
      .filter((item): item is PhotoMapping => item !== null)
      .sort((a, b) => Number(b.isPrincipal) - Number(a.isPrincipal));
  } catch {
    return [];
  }
}
