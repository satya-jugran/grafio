import { describe } from '@jest/globals';
import { Graph } from '../src/index';
import { runSocialGraphScenarios } from '../src/shared/testing/socialGraphScenarios';

describe('Facebook Social Graph (InMemory)', () => {
  runSocialGraphScenarios();
});
