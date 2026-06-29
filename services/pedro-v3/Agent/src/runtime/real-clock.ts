import type { Clock } from "../domain/ports.ts";

export class RealClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}
