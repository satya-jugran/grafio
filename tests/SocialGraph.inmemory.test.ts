import { describe } from '@jest/globals';
import { runSocialGraphScenarios } from '../src/shared/testing/socialGraphScenarios';

describe('Facebook Social Graph (InMemory)', () => {
  runSocialGraphScenarios();
});
