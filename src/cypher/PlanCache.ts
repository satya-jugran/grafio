/**
 * Bounded LRU cache for compiled Cypher {@link QueryPlan}s keyed by query string
 * and automatically invalidated when the backing graph's `indexEpoch` advances.
 *
 * @module cypher/PlanCache
 */

import type { QueryPlan } from './plan/QueryPlan';
import type { CompiledPlanMeta } from './plan/CompiledPlanMeta';

export interface CachedPlanEntry {
  readonly plan: QueryPlan;
  readonly meta: CompiledPlanMeta;
  readonly paramNames: readonly string[];
  readonly indexEpoch: number;
  readonly mutatingClause: string | null;
}

export class PlanCache {
  private readonly _maxSize: number;
  private readonly _cache = new Map<string, CachedPlanEntry>();

  constructor(maxSize = 512) {
    this._maxSize = Math.max(0, maxSize);
  }

  get size(): number {
    return this._cache.size;
  }

  get(query: string, currentIndexEpoch: number): CachedPlanEntry | undefined {
    if (this._maxSize === 0) return undefined;
    const entry = this._cache.get(query);
    if (!entry) return undefined;

    if (entry.indexEpoch !== currentIndexEpoch) {
      this._cache.delete(query);
      return undefined;
    }

    // Refresh LRU recency
    this._cache.delete(query);
    this._cache.set(query, entry);
    return entry;
  }

  set(query: string, entry: CachedPlanEntry): void {
    if (this._maxSize === 0) return;
    if (this._cache.has(query)) {
      this._cache.delete(query);
    } else if (this._cache.size >= this._maxSize) {
      const oldestKey = this._cache.keys().next().value;
      if (oldestKey !== undefined) {
        this._cache.delete(oldestKey);
      }
    }
    this._cache.set(query, entry);
  }

  clear(): void {
    this._cache.clear();
  }
}
