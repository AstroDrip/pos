/** The one interface every server module uses, so tests can run the same code on an in-process Postgres. */
export interface Statement {
  text: string;
  params?: unknown[];
}

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs all statements in one transaction. */
  batch(statements: Statement[]): Promise<void>;
}
