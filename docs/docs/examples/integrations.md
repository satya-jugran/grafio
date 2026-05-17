# Integration Examples

Integrating Grafio with other tools.

## MongoDB Storage

```typescript
import { Graph } from 'grafio';
import { MongoStorageProvider } from 'grafio-mongo';

const provider = new MongoStorageProvider({
  connectionString: 'mongodb://localhost:27017',
  database: 'grafio'
});

const graph = new Graph(provider);
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
import { Graph } from 'grafio';

const app = express();
const graph = new Graph();

app.get('/nodes', async (req, res) => {
  const nodes = await graph.getNodes();
  res.json(nodes);
});
```

For more integrations, see the main [Guides](../guides/overview) section.