import { describe, expect, it } from '@jest/globals';
import { extractGraphData } from '../../visualizer/src/extractGraphData';

describe('@grafio/visualizer extractGraphData', () => {
  it('synthesizes minimal stub nodes for dangling edge-only projections', () => {
    const result = extractGraphData([
      {
        r: {
          id: 'e1',
          sourceId: 'n1',
          targetId: 'n2',
          type: 'SYNAPSE',
          properties: { weight: 0.9 },
        },
      },
    ]);

    expect(result.links).toHaveLength(1);
    expect(result.links[0]).toMatchObject({
      id: 'e1',
      source: 'n1',
      target: 'n2',
      name: 'SYNAPSE',
    });
    expect(result.nodes).toEqual([
      { id: 'n1', label: 'n1' },
      { id: 'n2', label: 'n2' },
    ]);
  });

  it('preserves hydrated nodes and only synthesizes stubs for missing endpoints', () => {
    const nodeA = { id: 'a', labels: ['Memory'], properties: { title: 'Root' } };
    const result = extractGraphData([
      {
        a: nodeA,
        r: { id: 'e1', sourceId: 'a', targetId: 'b', type: 'SYNAPSE', properties: {} },
      },
    ]);

    expect(result.nodes).toEqual([
      { id: 'a', label: 'Memory', data: nodeA },
      { id: 'b', label: 'b' },
    ]);
  });

  it('deduplicates stub nodes across self-loops and shared missing endpoints', () => {
    const result = extractGraphData([
      { r: { id: 'e1', sourceId: 'x', targetId: 'x', type: 'SELF', properties: {} } },
      { r: { id: 'e2', sourceId: 'x', targetId: 'y', type: 'NEXT', properties: {} } },
    ]);

    expect(result.nodes).toEqual([
      { id: 'x', label: 'x' },
      { id: 'y', label: 'y' },
    ]);
    expect(result.links).toHaveLength(2);
  });

  it('prefers real nodes appearing in later rows over stub synthesis', () => {
    const nodeB = { id: 'b', labels: ['LTM'], properties: { name: 'Target' } };
    const result = extractGraphData([
      { r: { id: 'e1', sourceId: 'a', targetId: 'b', type: 'LINKS', properties: {} } },
      { b: nodeB },
    ]);

    expect(result.nodes).toEqual([
      { id: 'b', label: 'LTM', data: nodeB },
      { id: 'a', label: 'a' },
    ]);
  });
});
