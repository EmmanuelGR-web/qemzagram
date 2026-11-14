import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { KeyValueStore } from './kv.port';

interface Entry {
  count: number;
  expiresAt: number;
}

/** Almacén en memoria del proceso: sirve para UNA instancia (desarrollo, tests o un solo servidor). */
@Injectable()
export class MemoryKeyValueStore extends KeyValueStore implements OnModuleDestroy {
  private readonly entries = new Map<string, Entry>();
  private readonly sweeper = setInterval(() => this.sweep(), 60_000);

  constructor() {
    super();
    this.sweeper.unref();
  }

  async setIfAbsent(key: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const current = this.entries.get(key);
    if (current && current.expiresAt > now) return false;
    this.entries.set(key, { count: 1, expiresAt: now + ttlMs });
    return true;
  }

  async increment(key: string, ttlMs: number): Promise<{ count: number; msLeft: number }> {
    const now = Date.now();
    const current = this.entries.get(key);
    if (!current || current.expiresAt <= now) {
      this.entries.set(key, { count: 1, expiresAt: now + ttlMs });
      return { count: 1, msLeft: ttlMs };
    }
    current.count += 1;
    return { count: current.count, msLeft: current.expiresAt - now };
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
  }
}
