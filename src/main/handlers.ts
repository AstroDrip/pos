import type { z } from 'zod';
import { schemas, type Channel, type IpcResult } from '../shared/ipc';
import { createProduct, lookup, searchProducts } from '../services/catalog';
import { DomainError, type Ctx } from '../services/context';
import { finalizeSale, receiptData, type ReceiptData } from '../services/sales';
import { closeShift, openShift, openShiftId, recordCashMovement, shiftSummary } from '../services/shifts';
import { authenticate, createUser, userCount, type User } from '../services/users';

export interface Printer {
  printReceipt(data: ReceiptData, copy: boolean): Promise<void>;
}

/** Login state lives in the main process. The renderer never tells us who it is. */
export interface Session {
  user: User | null;
}

type Payload<C extends Channel> = z.infer<(typeof schemas)[C]>;
type Handler<C extends Channel> = (p: Payload<C>, s: Session) => unknown;

const PUBLIC: ReadonlySet<Channel> = new Set(['auth.status', 'auth.setupAdmin', 'auth.login']);

export function createHandlers(ctx: Ctx, printer: Printer) {
  const userId = (s: Session) => s.user!.id;

  const handlers: { [C in Channel]: Handler<C> } = {
    'auth.status': (_p, s) => ({ needsSetup: userCount(ctx) === 0, user: s.user }),
    'auth.setupAdmin': (p, s) => {
      // Only allowed on a brand-new database.
      if (userCount(ctx) !== 0) throw new DomainError('PERMISSION_DENIED', 'Setup already done');
      createUser(ctx, null, { ...p, roles: ['admin'] });
      s.user = authenticate(ctx, p.username, p.pin);
      return s.user;
    },
    'auth.login': (p, s) => (s.user = authenticate(ctx, p.username, p.pin)),
    'auth.logout': (_p, s) => {
      s.user = null;
      return null;
    },
    'shift.current': () => {
      const id = openShiftId(ctx);
      return id === null ? null : shiftSummary(ctx, id);
    },
    'shift.open': (p, s) => shiftSummary(ctx, openShift(ctx, userId(s), p.openingFloat)),
    'shift.close': (p, s) => closeShift(ctx, userId(s), p.countedCash),
    'cash.move': (p, s) => recordCashMovement(ctx, userId(s), p.kind, p.amount, p.reason),
    'catalog.lookup': (p) => lookup(ctx, p.code),
    'catalog.search': (p) => searchProducts(ctx, p.text),
    'catalog.create': (p, s) => createProduct(ctx, userId(s), p),
    'sale.finalize': (p, s) => {
      let discountApproverId: number | undefined;
      if (p.approver) discountApproverId = authenticate(ctx, p.approver.username, p.approver.pin).id;
      return finalizeSale(ctx, userId(s), { idempotencyKey: p.idempotencyKey, lines: p.lines, payments: p.payments, discountApproverId });
    },
    'sale.receipt': (p) => receiptData(ctx, p.saleId),
    'sale.print': async (p) => {
      await printer.printReceipt(receiptData(ctx, p.saleId), p.copy);
      return null;
    },
  };

  /** Validates, checks login, runs the handler and turns errors into a safe result. */
  return async function dispatch(channel: string, payload: unknown, session: Session): Promise<IpcResult<unknown>> {
    if (!Object.hasOwn(schemas, channel)) return { ok: false, code: 'BAD_CHANNEL', message: 'Unknown operation' };
    const c = channel as Channel;
    const parsed = schemas[c].safeParse(payload);
    if (!parsed.success) return { ok: false, code: 'VALIDATION', message: 'Invalid request data' };
    if (!PUBLIC.has(c) && !session.user) return { ok: false, code: 'AUTH_REQUIRED', message: 'Please log in' };
    try {
      return { ok: true, data: await (handlers[c] as Handler<Channel>)(parsed.data as never, session) };
    } catch (e) {
      if (e instanceof DomainError) return { ok: false, code: e.code, message: e.message };
      console.error(`[ipc] ${c} failed`, e);
      // Sale finalization is one transaction, so an unexpected error means nothing was saved.
      return { ok: false, code: 'INTERNAL', message: c === 'sale.finalize' ? 'Sale NOT saved. Nothing was recorded. Try again.' : 'Unexpected error' };
    }
  };
}
