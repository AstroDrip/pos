import { randomUUID } from 'node:crypto';
import type { Db } from '../db/connection';

/** Everything a service needs. Clock and id source are injectable so tests are deterministic. */
export interface Ctx {
  db: Db;
  now: () => string;
  uuid: () => string;
}

export function makeCtx(db: Db): Ctx {
  return { db, now: () => new Date().toISOString(), uuid: randomUUID };
}

export type ErrorCode =
  | 'POSSIBLE_DUPLICATE'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'PERMISSION_DENIED'
  | 'AUTH_FAILED'
  | 'LOCKED'
  | 'NO_OPEN_SHIFT'
  | 'SHIFT_ALREADY_OPEN'
  | 'INSUFFICIENT_PAYMENT'
  | 'NEGATIVE_STOCK'
  | 'CONFLICT'
  | 'PRICE_CHANGED'
  | 'CLOCK_WRONG';

/** Expected business errors. Their message is safe to show to staff. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
