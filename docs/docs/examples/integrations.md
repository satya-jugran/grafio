# Integration Examples

Integrating Grafio with other tools.

## MongoDB Storage

```typescript
import { GraphManager } from 'grafio';
import { MongoGraphFactory } from 'grafio-mongo';

const factory = new MongoGraphFactory(db);
const graph = factory.forGraph('default');
```

## Redis Caching

```typescript
import { GraphManager } from 'grafio';

GraphManager.init({
  cache: {
    cacheStore: 'redis',
    ttlSeconds: 3600
  }
});
```

## Express.js API

```typescript
import express from 'express';
import { InMemoryGraphFactory } from 'grafio';

const app = express();
const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('default');

app.get('/nodes', async (req, res) => {
  const nodes = await graph.getNodes();
  res.json(nodes);
});
```

For more integrations, see the main [Guides](../guides/overview) section.