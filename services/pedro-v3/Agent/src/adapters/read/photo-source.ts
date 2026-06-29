import type {
  VehiclePhotoSource,
  TenantAgentRef,
  PhotoResolveResult,
  NormalizedVehicle
} from "../../domain/read-ports.ts";
import type { StockLoader } from "./stock-loader.ts";
import {
  generateVehicleKey,
  parseVehiclePhotos
} from "./stock-normalizer.ts";

export class V2VehiclePhotoSource implements VehiclePhotoSource {
  constructor(
    private readonly loader: StockLoader
  ) {}

  // 1. resolvePhotos
  async resolvePhotos(ref: TenantAgentRef, vehicleKey: string): Promise<PhotoResolveResult> {
    const vehicles = await this.loader.loadAll(ref);

    // Identifica colisões de fingerprint
    const fingerprintCounts = new Map<string, number>();
    for (const v of vehicles) {
      const { key } = generateVehicleKey(v);
      fingerprintCounts.set(key, (fingerprintCounts.get(key) || 0) + 1);
    }

    const isAmbiguous = (fingerprintCounts.get(vehicleKey) || 0) > 1;
    if (isAmbiguous) {
      return {
        vehicleKey,
        ambiguous: true,
        photoIds: []
      };
    }

    // Acha o veículo único
    const vehicle = vehicles.find((v: NormalizedVehicle) => {
      const { key } = generateVehicleKey(v);
      return key === vehicleKey;
    });

    if (!vehicle) {
      return {
        vehicleKey,
        ambiguous: false,
        photoIds: []
      };
    }

    const photos = parseVehiclePhotos(vehicleKey, vehicle.pictureJs);
    return {
      vehicleKey,
      ambiguous: false,
      photoIds: photos.map(p => p.id)
    };
  }

  // 2. resolveUrls
  async resolveUrls(ref: TenantAgentRef, vehicleKey: string, photoIds: readonly string[]): Promise<readonly string[]> {
    const vehicles = await this.loader.loadAll(ref);

    // Identifica colisões de fingerprint - se for ambíguo, proíbe URLs (segurança extra)
    const fingerprintCounts = new Map<string, number>();
    for (const v of vehicles) {
      const { key } = generateVehicleKey(v);
      fingerprintCounts.set(key, (fingerprintCounts.get(key) || 0) + 1);
    }

    const isAmbiguous = (fingerprintCounts.get(vehicleKey) || 0) > 1;
    if (isAmbiguous) {
      return [];
    }

    const vehicle = vehicles.find((v: NormalizedVehicle) => {
      const { key } = generateVehicleKey(v);
      return key === vehicleKey;
    });

    if (!vehicle) {
      return [];
    }

    const photos = parseVehiclePhotos(vehicleKey, vehicle.pictureJs);
    const photoIdSet = new Set(photoIds);

    // Filtra as URLs atuais cujos photoIds coincidem
    return photos
      .filter(p => photoIdSet.has(p.id))
      .map(p => p.url);
  }
}
