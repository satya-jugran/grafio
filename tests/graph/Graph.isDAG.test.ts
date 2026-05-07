import { runGraphIsDAGScenarios } from '../../src/shared/testing';

runGraphIsDAGScenarios(
  async () => undefined as any,
  async () => {},
  async () => {}
);