import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  gettingStarted: [
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/installation',
        'getting-started/quick-start',
        'getting-started/your-first-graph',
      ],
    },
  ],

  guides: [
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: [
        'guides/core-concepts',
        'guides/cypher-language',
        'guides/querying-graph',
        'guides/data-operations',
        'guides/filtering',
        'guides/aggregation',
        'guides/transactions',
        'guides/exception-handling',
        'guides/query-plans',
        'guides/caching',
        'guides/storage-providers',
        'guides/serialization',
        'guides/graph-analysis',
        'guides/visualization',
      ],
    },
  ],

  apiReference: [
    {
      type: 'category',
      label: 'API Reference',
      collapsed: false,
      items: [
        {
          type: 'category',
          label: 'Core Classes',
          items: [
            'api-reference/graph',
            'api-reference/node',
            'api-reference/edge',
          ],
        },
        {
          type: 'category',
          label: 'Query Engine',
          items: [
            'api-reference/cypher-engine',
            'api-reference/cypher-clauses',
            'api-reference/cypher-functions',
            'api-reference/cypher-errors',
          ],
        },
        {
          type: 'category',
          label: 'Storage',
          items: [
            'api-reference/storage-provider',
            'api-reference/in-memory-storage',
          ],
        },
        {
          type: 'category',
          label: 'Caching',
          items: [
            'api-reference/graph-manager',
            'api-reference/cache-manager',
            'api-reference/cache-config',
          ],
        },
        {
          type: 'category',
          label: 'Utilities',
          items: [
            'api-reference/graph-to-mermaid',
            'api-reference/graph-transaction',
            'api-reference/errors',
          ],
        },
      ],
    },
  ],

  tutorials: [
    {
      type: 'category',
      label: 'Tutorials',
      collapsed: false,
      items: [
        'tutorials/social-network',
        'tutorials/hierarchical-data',
        'tutorials/multi-hop-queries',
        'tutorials/real-time-filtering',
      ],
    },
  ],
  examples: [
    {
      type: 'category',
      label: 'Examples',
      collapsed: true,
      items: [
        'examples/basic-operations',
        'examples/advanced-queries',
        'examples/performance',
        'examples/integrations',
      ],
    },
  ],

  contribute: [
    {
      type: 'category',
      label: 'Contribute',
      collapsed: true,
      items: [
        'contribute/introduction',
      ],
    },
  ],
};

export default sidebars;