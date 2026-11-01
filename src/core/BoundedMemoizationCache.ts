// Port of: F:\dogsc\Sources\RecorderCore\BoundedMemoizationCache.swift
import { max } from './swift.ts';

function defaultKeySerializer<K>(key: K): string {
  if (typeof key === 'object' && key !== null) {
    return JSON.stringify(key, Object.keys(key as Record<string, unknown>).sort());
  }
  return String(key);
}

/**
 * Small LRU used for expensive deterministic render paths whose parameter keys
 * can change continuously while an inspector slider moves.
 * Keeping every historical parameter value turns one gesture on a long recording
 * into unbounded arrays of precomputed samples.
 *
 * Swift original used NSCondition for thread safety; in single-threaded JS/TS
 * the synchronization primitives are omitted.
 */
export class BoundedMemoizationCache<Key, Value> {
  private readonly capacity: number;
  private readonly serializeKey: (key: Key) => string;
  private readonly values = new Map<string, Value>();
  private recency: string[] = [];

  constructor(
    capacity: number,
    serializeKey: (key: Key) => string = defaultKeySerializer,
  ) {
    this.capacity = max(capacity, 1);
    this.serializeKey = serializeKey;
  }

  get count(): number {
    return this.values.size;
  }

  /**
   * Retrieves an existing value or computes, caches and returns it.
   * Swift: `value(for:build:)`.
   */
  value(key: Key, build: () => Value): Value {
    const k = this.serializeKey(key);
    const existing = this.values.get(k);
    if (existing !== undefined) {
      this.markRecentlyUsed(k);
      return existing;
    }
    const created = build();
    return this.finishBuild(created, k) ?? created;
  }

  /**
   * Builds a value only when the caller can finish the complete work. This is
   * used by cancellable background prewarming: a cancelled partial result
   * (returning null) must never occupy the cache and later masquerade as a
   * complete render path.
   * Swift: `valueIfBuilt(for:build:)`.
   */
  valueIfBuilt(key: Key, build: () => Value | null): Value | null {
    const k = this.serializeKey(key);
    const existing = this.values.get(k);
    if (existing !== undefined) {
      this.markRecentlyUsed(k);
      return existing;
    }
    const created = build();
    return this.finishBuild(created, k);
  }

  private finishBuild(created: Value | null, k: string): Value | null {
    const existing = this.values.get(k);
    if (existing !== undefined) {
      this.markRecentlyUsed(k);
      return existing;
    }
    if (created === null || created === undefined) {
      return null;
    }
    this.values.set(k, created);
    this.markRecentlyUsed(k);
    while (this.recency.length > this.capacity) {
      const evicted = this.recency.shift();
      if (evicted !== undefined) {
        this.values.delete(evicted);
      }
    }
    return created;
  }

  private markRecentlyUsed(k: string): void {
    const index = this.recency.indexOf(k);
    if (index !== -1) {
      this.recency.splice(index, 1);
    }
    this.recency.push(k);
  }
}
