import { runGraphNodeScenarios } from '../../src/shared/testing';

// InMemory provider - no setup needed, providerFunc defaults to undefined
runGraphNodeScenarios(
  async () => undefined as any,
  async () => {},
  async () => {}
);