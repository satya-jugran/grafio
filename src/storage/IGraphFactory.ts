import type { Graph } from '../Graph';
import { GraphData } from '../types';

/**
 * Factory interface for creating Graph instances backed by a specific storage provider.
 *
 * Encapsulates the lifecycle of the underlying storage so that consumers can obtain
 * a scoped Graph without managing provider instances directly.
 *
 * IoC containers (Inversify, NestJS, etc.) can bind this interface to a concrete
 * factory (e.g. `MongoGraphFactory`) as a singleton.
 *
 * @example
 * container.bind<IGraphFactory>('IGraphFactory').to(MongoGraphFactory).inSingletonScope();
 *
 * class UserService {
 *   constructor(@inject('IGraphFactory') private factory: IGraphFactory) {}
 *
 *   doWork(userId: string) {
 *     const graph = this.factory.forGraph(userId);
 *   }
 * }
 */
export interface IGraphFactory {
  /**
   * Returns a Graph instance scoped to the given graphId.
   *
   * @param graphId - Partition key. Defaults to "default" when omitted.
   *                  All nodes/edges created on the returned Graph belong to this partition.
   */
  forGraph(graphId?: string): Graph;

  fromGraphData(data: GraphData, graphId?: string): Promise<Graph>;
}
