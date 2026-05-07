import { runGraphEdgeScenarios } from '../../src/shared/testing';

// InMemory provider - no setup needed, providerFunc defaults to undefined
runGraphEdgeScenarios(
  async () => undefined as any,
  async () => {},
  async () => {}
);