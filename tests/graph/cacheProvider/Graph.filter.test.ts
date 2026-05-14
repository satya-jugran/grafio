import { CacheConfig, CachedStorageProvider, CacheManager, InMemoryStorageProvider } from '../../../src';
import { runGraphFilterScenarios } from '../../../src/shared/testing';

runGraphFilterScenarios(
  async () => {
    const cacheConfig: CacheConfig = {
      cacheStore: 'in-memory',
      maxNodesCount: 100,
      maxEdgesCount: 100,
      preloadStrategy: 'all',
      evictionStrategy: 'LRU',
    };
    const cacheManager = new CacheManager(cacheConfig);
    const provider = new CachedStorageProvider(new InMemoryStorageProvider(), 'test-graph', cacheManager, cacheConfig);
    await provider.warmCache();
    return provider;
  }
);