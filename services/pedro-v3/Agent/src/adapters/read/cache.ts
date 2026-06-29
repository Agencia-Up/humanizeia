import type { Clock } from "../../domain/ports.ts";

export type CacheOptions = {
  readonly ttlMs: number;
  readonly maxItems: number;
  readonly enabled: boolean;
};

type CacheEntry<T> = {
  readonly value: T;
  readonly expiresAt: number;
  readonly tenantId: string;
  readonly provider: string;
  lastUsed: number;
};

type PendingEntry<T> = {
  readonly promise: Promise<T>;
  readonly version: number;
  readonly flightId: number;
};

export class ReadCache<T> {
  private readonly cache = new Map<string, CacheEntry<T>>();
  private readonly pendingPromises = new Map<string, PendingEntry<T>>();
  private readonly keyVersions = new Map<string, number>();
  private nextFlightId = 1;

  constructor(
    private readonly clock: Clock,
    private readonly options: CacheOptions
  ) {}

  private makeKey(tenantId: string, provider: string, extra = ""): string {
    return `${tenantId}:${provider}:${extra}`;
  }

  private versionFor(key: string): number {
    return this.keyVersions.get(key) ?? 0;
  }

  private bumpVersion(key: string): void {
    this.keyVersions.set(key, this.versionFor(key) + 1);
  }

  async getOrFetch(
    tenantId: string,
    provider: string,
    extra: string,
    fetchFn: () => Promise<T>
  ): Promise<T> {
    if (!this.options.enabled) {
      return fetchFn();
    }

    const key = this.makeKey(tenantId, provider, extra);
    const now = Date.parse(this.clock.now());

    const entry = this.cache.get(key);
    if (entry && entry.expiresAt > now && entry.tenantId === tenantId && entry.provider === provider) {
      entry.lastUsed = now;
      return entry.value;
    }

    const existingPending = this.pendingPromises.get(key);
    if (existingPending && existingPending.version === this.versionFor(key)) {
      return existingPending.promise;
    }

    const version = this.versionFor(key);
    const flightId = this.nextFlightId++;

    const promise = fetchFn().then((value) => {
      const currentPending = this.pendingPromises.get(key);
      const stillCurrentFlight = currentPending?.flightId === flightId && currentPending.version === version;
      const stillCurrentVersion = this.versionFor(key) === version;

      if (stillCurrentFlight && stillCurrentVersion) {
        const entryNow = Date.parse(this.clock.now());
        const expiresAt = entryNow + this.options.ttlMs;

        if (this.cache.size >= this.options.maxItems) {
          this.evictLeastRecentlyUsed();
        }

        this.cache.set(key, {
          value,
          expiresAt,
          tenantId,
          provider,
          lastUsed: entryNow
        });
        this.pendingPromises.delete(key);
      }

      return value;
    }).catch((err) => {
      const currentPending = this.pendingPromises.get(key);
      if (currentPending?.flightId === flightId) {
        this.pendingPromises.delete(key);
      }
      throw err;
    });

    this.pendingPromises.set(key, { promise, version, flightId });
    return promise;
  }

  private evictLeastRecentlyUsed(): void {
    let oldestKey: string | null = null;
    let oldestTime = Number.MAX_VALUE;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  invalidate(tenantId: string, provider: string): void {
    const prefix = `${tenantId}:${provider}:`;

    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        this.bumpVersion(key);
      }
    }

    for (const key of Array.from(this.pendingPromises.keys())) {
      if (key.startsWith(prefix)) {
        this.pendingPromises.delete(key);
        this.bumpVersion(key);
      }
    }

    for (const key of Array.from(this.keyVersions.keys())) {
      if (key.startsWith(prefix) && !this.cache.has(key) && !this.pendingPromises.has(key)) {
        this.bumpVersion(key);
      }
    }
  }

  clear(): void {
    const knownKeys = new Set<string>([
      ...this.cache.keys(),
      ...this.pendingPromises.keys(),
      ...this.keyVersions.keys()
    ]);
    this.cache.clear();
    this.pendingPromises.clear();
    for (const key of knownKeys) {
      this.bumpVersion(key);
    }
  }
}
