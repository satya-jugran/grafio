import { describe } from '@jest/globals';
import { runSocialGraphScenarios } from '../src/shared/testing/socialGraphScenarios';
import { runSocialGraphCypherScenarios } from '../src/shared/testing/cypher/socialGraphScenarios';
describe('Facebook Social Graph', () => {
  runSocialGraphScenarios();
});

describe('Facebook Social Graph - Cypher', () => {
  runSocialGraphCypherScenarios();
});
