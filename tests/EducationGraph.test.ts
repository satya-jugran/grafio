import { describe } from '@jest/globals';
import { Graph } from '../src/index';
import { educationGraphData, runEducationGraphScenarios } from '../src/shared/testing';
import { runEducationGraphCypherScenarios } from '../src/shared/testing/cypher/educationGraphScenarios';

describe('Education Graph', () => {
  runEducationGraphScenarios(async () => {
    return await Graph.importJSON(educationGraphData);
  });
});

describe('Education Graph (Cypher)', () => {
  runEducationGraphCypherScenarios(async () => {
    return await Graph.importJSON(educationGraphData);
  });
});
