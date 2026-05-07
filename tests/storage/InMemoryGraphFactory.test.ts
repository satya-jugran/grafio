import { describe, expect, it } from '@jest/globals';

import { InMemoryGraphFactory } from '../../src/storage/InMemoryGraphFactory';
import { runGraphFactoryScenarios } from '../../src/shared/testing';

runGraphFactoryScenarios(
  async () => {
    return new InMemoryGraphFactory();
  }
);
