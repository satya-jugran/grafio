import { CacheConfig, CachedStorageProvider, CacheManager, InMemoryStorageProvider } from '../../src';
import { runGraphFilterScenarios } from '../../src/shared/testing';

// InMemory provider - no setup needed, providerFunc defaults to undefined
runGraphFilterScenarios(
  async () => undefined as any,
);