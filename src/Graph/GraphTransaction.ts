import type { IStorageProvider, ITransactionHandle } from '../storage/IStorageProvider';

/**
 * Error thrown when an operation is attempted on an inactive transaction.
 */
export class TransactionNotActiveError extends Error {
  constructor(message = 'Transaction is not active') {
    super(message);
    this.name = 'TransactionNotActiveError';
  }
}

/**
 * Error thrown when commit is attempted on a failed transaction.
 */
export class TransactionFailedError extends Error {
  constructor(message = 'Transaction has failed and can only be rolled back') {
    super(message);
    this.name = 'TransactionFailedError';
  }
}

/**
 * Manages the lifecycle of a graph transaction.
 *
 * A transaction allows multiple graph operations to be performed atomically:
 * all changes are applied together on commit, or discarded on rollback.
 *
 * @example
 * const txn = graph.createTransaction();
 * try {
 *   await txn.begin();
 *   const node1 = await graph.addNode('Person', { name: 'Alice' }, txn);
 *   const node2 = await graph.addNode('Person', { name: 'Bob' }, txn);
 *   await graph.addEdge(node1.id, node2.id, 'knows', {}, txn);
 *   await txn.commit();
 * } catch (error) {
 *   if (txn.isActive()) {
 *     await txn.rollback();
 *   }
 * }
 */
export class GraphTransaction {
  private _handle: ITransactionHandle | null = null;
  private _failed = false;
  private readonly _store: IStorageProvider;

  /**
   * @param store - The storage provider to use for this transaction
   */
  constructor(store: IStorageProvider) {
    this._store = store;
  }

  /**
   * Starts a new transaction.
   * @throws Error if a transaction is already active
   */
  async begin(): Promise<void> {
    if (this._handle !== null) {
      throw new Error('Transaction already active');
    }
    this._handle = await this._store.beginTransaction();
    this._failed = false;
  }

  /**
   * Commits the active transaction, applying all changes atomically.
   * @throws TransactionNotActiveError if no transaction is active
   * @throws TransactionFailedError if the transaction has failed
   */
  async commit(): Promise<void> {
    if (this._handle === null) {
      throw new TransactionNotActiveError();
    }
    if (this._failed) {
      throw new TransactionFailedError();
    }
    await this._store.commitTransaction(this._handle);
    this._handle = null;
  }

  /**
   * Rolls back the active transaction, discarding all changes.
   * @throws TransactionNotActiveError if no transaction is active
   */
  async rollback(): Promise<void> {
    if (this._handle === null) {
      throw new TransactionNotActiveError();
    }
    await this._store.rollbackTransaction(this._handle);
    this._handle = null;
    this._failed = false;
  }

  /**
   * Checks if a transaction is currently active.
   */
  isActive(): boolean {
    return this._handle !== null && !this._failed;
  }

  /**
   * Checks if the transaction has failed and can only be rolled back.
   */
  isFailed(): boolean {
    return this._failed;
  }

  /**
   * Internal method to retrieve the transaction handle for storage provider communication.
   * @internal
   */
  _getHandle(): ITransactionHandle | undefined {
    return this._handle ?? undefined;
  }

}
