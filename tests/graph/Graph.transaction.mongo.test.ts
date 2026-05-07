import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { MongoStorageProvider } from '../../src/storage/MongoStorageProvider';
import { runGraphTransactionScenarios } from '../../src/shared/testing';

let mongoServer: MongoMemoryReplSet;
let client: MongoClient;
let provider: MongoStorageProvider;

runGraphTransactionScenarios(
  async () => {
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 2 } });
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    provider = new MongoStorageProvider(client.db('test'), { graphId: 'test-transactions' });
    await provider.ensureIndexes();
    return provider;
  },
  async () => {},
  async () => {
    await client.close();
    await mongoServer.stop();
  }
);