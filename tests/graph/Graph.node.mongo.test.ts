import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { MongoStorageProvider } from '../../src/storage/MongoStorageProvider';
import { runGraphNodeScenarios } from '../../src/shared/testing';

let mongoServer: MongoMemoryServer;
let client: MongoClient;
let provider: MongoStorageProvider;

runGraphNodeScenarios(
  async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    provider = new MongoStorageProvider(client.db('test'), { graphId: 'default' });
    await provider.ensureIndexes();
    return provider;
  },
  async () => {},
  async () => {
    await client.close();
    await mongoServer.stop();
  }
);