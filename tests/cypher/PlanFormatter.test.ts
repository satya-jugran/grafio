/**
 * Unit tests for the PlanFormatter class.
 *
 * @module tests/cypher/PlanFormatter.test
 */
import { describe, expect, it, beforeEach } from '@jest/globals';
import { PlanFormatter, PlanFormat } from '../../src/cypher/plan/PlanFormatter';
import { QueryPlan } from '../../src/cypher/plan/QueryPlan';

describe('PlanFormatter', () => {
  let formatter: PlanFormatter;

  beforeEach(() => {
    formatter = new PlanFormatter();
  });

  describe('format', () => {
    it('returns json format by default', () => {
      const plan: QueryPlan = {
        steps: [
          {
            kind: 'NodeScanStep',
            label: 'Person',
            variable: 'p',
          },
        ],
      };

      const result = formatter.format(plan, 'json');
      expect(result).toContain('"kind": "NodeScanStep"');
      expect(result).toContain('"variable": "p"');
    });

    it('returns ascii format', () => {
      const plan: QueryPlan = {
        steps: [
          {
            kind: 'NodeScanStep',
            label: 'Person',
            variable: 'p',
          },
          {
            kind: 'ProjectStep',
            columns: [{ expression: { kind: 'Identifier', name: 'p' }, alias: 'person' }],
            distinct: false,
          },
        ],
      };

      const result = formatter.format(plan, 'ascii');
      expect(result).toContain('NodeScanStep');
      expect(result).toContain('ProjectStep');
    });

    it('returns mermaid format', () => {
      const plan: QueryPlan = {
        steps: [
          {
            kind: 'NodeScanStep',
            label: 'Person',
            variable: 'p',
          },
          {
            kind: 'ProjectStep',
            columns: [{ expression: { kind: 'Identifier', name: 'p' }, alias: 'person' }],
            distinct: false,
          },
        ],
      };

      const result = formatter.format(plan, 'mermaid');
      expect(result).toContain('flowchart TD');
      expect(result).toContain('Step1[');
      expect(result).toContain('Step2[');
      expect(result).toContain('-->');
    });
  });

  describe('toJson', () => {
    it('serializes NodeScanStep', () => {
      const plan: QueryPlan = {
        steps: [
          {
            kind: 'NodeScanStep',
            label: 'Person',
            variable: 'p',
            types: ['Person'],
          },
        ],
      };

      const result = formatter.format(plan, 'json');
      const parsed = JSON.parse(result);

      expect(parsed.steps).toHaveLength(1);
      expect(parsed.steps[0].kind).toBe('NodeScanStep');
      expect(parsed.steps[0].variable).toBe('p');
      expect(parsed.steps[0].label).toBe('Person');
    });

    it('serializes full plan with all step types', () => {
      const plan: QueryPlan = {
        steps: [
          { kind: 'NodeScanStep', label: 'Person', variable: 'p' },
          {
            kind: 'EdgeExpandStep',
            source: 'p',
            target: 'f',
            types: ['KNOWS'],
            direction: 'out',
            minHops: 1,
            maxHops: 1,
            strategy: 'single-hop',
          },
          { kind: 'FilterStep', predicate: { kind: 'PropertyAccess', object: { kind: 'Identifier', name: 'f' }, property: 'name' } },
          {
            kind: 'ProjectStep',
            columns: [{ expression: { kind: 'Identifier', name: 'f' }, alias: 'friend' }],
            distinct: false,
          },
        ],
      };

      const result = formatter.format(plan, 'json');
      const parsed = JSON.parse(result);

      expect(parsed.steps).toHaveLength(4);
      expect(parsed.steps[0].kind).toBe('NodeScanStep');
      expect(parsed.steps[1].kind).toBe('EdgeExpandStep');
      expect(parsed.steps[2].kind).toBe('FilterStep');
      expect(parsed.steps[3].kind).toBe('ProjectStep');
    });
  });

  describe('toAscii', () => {
    it('describes NodeScanStep correctly', () => {
      const plan: QueryPlan = {
        steps: [
          {
            kind: 'NodeScanStep',
            label: 'Person',
            variable: 'p',
          },
        ],
      };

      const result = formatter.format(plan, 'ascii');
      expect(result).toContain('NodeScanStep (p:Person)');
    });

    it('describes EdgeExpandStep with direction arrow', () => {
      const plan: QueryPlan = {
        steps: [
          {
            kind: 'EdgeExpandStep',
            source: 'p',
            target: 'f',
            types: ['KNOWS'],
            direction: 'out',
            minHops: 1,
            maxHops: 1,
            strategy: 'single-hop',
          },
        ],
      };

      const result = formatter.format(plan, 'ascii');
      expect(result).toContain('EdgeExpandStep');
      expect(result).toContain('\u2192');
    });

    it('describes ProjectStep with column aliases', () => {
      const plan: QueryPlan = {
        steps: [
          {
            kind: 'ProjectStep',
            columns: [
              { expression: { kind: 'Identifier', name: 'n' }, alias: 'node' },
              { expression: { kind: 'Identifier', name: 'r' }, alias: 'rel' },
            ],
            distinct: false,
          },
        ],
      };

      const result = formatter.format(plan, 'ascii');
      expect(result).toContain('ProjectStep [node, rel]');
    });

    it('describes AggregateStep with function names', () => {
      const plan: QueryPlan = {
        steps: [
          {
            kind: 'AggregateStep',
            aggregates: [
              { function: 'COUNT', expression: { kind: 'Identifier', name: 'n' }, distinct: false, alias: 'cnt' },
              { function: 'SUM', expression: { kind: 'PropertyAccess', object: { kind: 'Identifier', name: 'n' }, property: 'age' }, distinct: false, alias: 'total' },
            ],
            groupBy: [],
            groupByAliases: [],
          },
        ],
      };

      const result = formatter.format(plan, 'ascii');
      expect(result).toContain('AggregateStep');
      expect(result).toContain('COUNT(cnt)');
      expect(result).toContain('SUM(total)');
    });
  });

  describe('toMermaid', () => {
    it('generates valid mermaid flowchart syntax', () => {
      const plan: QueryPlan = {
        steps: [
          { kind: 'NodeScanStep', label: 'Person', variable: 'p' },
          { kind: 'ProjectStep', columns: [], distinct: false },
        ],
      };

      const result = formatter.format(plan, 'mermaid');
      const lines = result.split('\n');

      expect(lines[0]).toBe('flowchart TD');
      expect(lines[1]).toMatch(/^ Step1\[/);
      expect(lines[2]).toMatch(/^ Step2\[/);
      expect(lines[3]).toBe(' Step1 --> Step2');
    });

    it('escapes special characters in step descriptions', () => {
      const plan: QueryPlan = {
        steps: [
          {
            kind: 'NodeScanStep',
            label: 'Person',
            variable: 'p',
          },
        ],
      };

      const result = formatter.format(plan, 'mermaid');
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
    });

    it('creates proper node sequence for multi-step plans', () => {
      const plan: QueryPlan = {
        steps: [
          { kind: 'NodeScanStep', label: 'A', variable: 'a' },
          { kind: 'FilterStep', predicate: { kind: 'Identifier', name: 'x' } },
          { kind: 'SortStep', items: [] },
          { kind: 'ProjectStep', columns: [], distinct: false },
        ],
      };

      const result = formatter.format(plan, 'mermaid');
      expect(result).toContain('Step1 --> Step2');
      expect(result).toContain('Step2 --> Step3');
      expect(result).toContain('Step3 --> Step4');
    });

    it('generates correct mermaid for a complex multi-hop query plan', () => {
      // Simulates a complex query like:
      // MATCH (a:Person)-[:KNOWS]->(b:Person)-[:KNOWS]->(c:Person)
      // WHERE a.age > 30 AND b.city = 'NYC'
      // RETURN c.name AS friend, c.age AS age
      // ORDER BY c.age DESC
      // SKIP 1 LIMIT 10
      const plan: QueryPlan = {
        steps: [
          {
            kind: 'NodeScanStep',
            label: 'Person',
            variable: 'a',
            types: ['Person'],
            propertyFilters: [
              { key: 'age', op: '>', value: 30 },
            ],
          },
          {
            kind: 'EdgeExpandStep',
            source: 'a',
            edgeVar: 'r1',
            target: 'b',
            types: ['KNOWS'],
            direction: 'out',
            minHops: 1,
            maxHops: 1,
            strategy: 'single-hop',
            targetTypes: ['Person'],
          },
          {
            kind: 'FilterStep',
            predicate: {
              kind: 'Binary',
              op: '=',
              left: { kind: 'PropertyAccess', object: { kind: 'Identifier', name: 'b' }, property: 'city' },
              right: { kind: 'Literal', value: 'NYC' },
            },
          },
          {
            kind: 'EdgeExpandStep',
            source: 'b',
            edgeVar: 'r2',
            target: 'c',
            types: ['KNOWS'],
            direction: 'out',
            minHops: 1,
            maxHops: 1,
            strategy: 'single-hop',
            targetTypes: ['Person'],
          },
          {
            kind: 'SortStep',
            items: [
              { expression: { kind: 'PropertyAccess', object: { kind: 'Identifier', name: 'c' }, property: 'age' }, direction: 'DESC' },
            ],
          },
          {
            kind: 'LimitStep',
            skipExpr: { kind: 'Literal', value: 1 },
            limitExpr: { kind: 'Literal', value: 10 },
          },
          {
            kind: 'ProjectStep',
            columns: [
              { expression: { kind: 'PropertyAccess', object: { kind: 'Identifier', name: 'c' }, property: 'name' }, alias: 'friend' },
              { expression: { kind: 'PropertyAccess', object: { kind: 'Identifier', name: 'c' }, property: 'age' }, alias: 'age' },
            ],
            distinct: false,
          },
        ],
      };

      const result = formatter.format(plan, 'mermaid');
      const lines = result.split('\n');

      // Verify structure: 1 header + 8 nodes + 7 arrows = 16 lines
      expect(lines[0]).toBe('flowchart TD');
      expect(lines.length).toBe(14);

      // Verify all 8 steps are present as node definitions
      const nodeLines = lines.filter(l => l.includes('[NodeScanStep') || l.includes('[EdgeExpandStep') || l.includes('[FilterStep') || l.includes('[SortStep') || l.includes('[LimitStep') || l.includes('[ProjectStep'));
      expect(nodeLines.length).toBe(7);

      // Verify all arrows are present
      const arrowLines = lines.filter(l => l.includes('-->'));
      expect(arrowLines.length).toBe(6);

      // Verify specific step order using contains
      expect(result).toContain('Step1[NodeScanStep');
      expect(result).toContain('Step2[EdgeExpandStep');
      expect(result).toContain('Step3[FilterStep');
      expect(result).toContain('Step4[EdgeExpandStep');
      expect(result).toContain('Step5[SortStep');
      expect(result).toContain('Step6[LimitStep');
      expect(result).toContain('Step7[ProjectStep');

      // Verify arrows are in correct order
      expect(result).toContain('Step1 --> Step2');
      expect(result).toContain('Step2 --> Step3');
      expect(result).toContain('Step3 --> Step4');
      expect(result).toContain('Step4 --> Step5');
      expect(result).toContain('Step5 --> Step6');
      expect(result).toContain('Step6 --> Step7');
    });
  });
});