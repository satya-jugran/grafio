import { describe } from '@jest/globals';
import { Graph } from '../src/index';
import { educationGraphData, runEducationGraphScenarios } from '../src/shared/testing';

describe('Education Graph (InMemory)', () => {
  runEducationGraphScenarios(async () => {
    return await Graph.importJSON(educationGraphData);
  });
});
