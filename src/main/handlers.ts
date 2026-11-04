import type { z } from 'zod';
import { schemas, type Channel, type IpcResult } from '../shared/ipc';
import { backupStatus, createBackup, prepareRestore } from '../services/backup';
import { keyToRecoveryCode, recoveryCodeToKey } from '../services/backup-crypto';
import { createProduct, getProduct, lookup, searchProducts } from '../services/catalog';
import { DomainError, type Ctx } from '../services/context';
import { appendAudit } from '../services/audit';
import { holdBill, listHeldBills, recallBill, recordRemoval } from '../services/held-bills';
import { dryRunProducts, dryRunSuppliers, importProducts, importSuppliers } from '../services/import';
import { receiveGoods } from '../services/inventory';
import { createCustomer, createSupplier, findCustomers, listSuppliers } from '../services/parties';
import { salesSummary, stockOnHand, voidsReport } from '../services/reports';
import { finalizeSale, receiptData, type ReceiptData } from '../services/sales';
import { closeShift, openShift, openShiftId, recordCashMovement, shiftSummary } from '../services/shifts';
import { authenticate, createUser, hasPermission, listUsers, requirePermission, userCount, type User } from '../services/users';

export interface Printer {
  printReceipt(data: ReceiptData, copy: boolean): Promise<void>;
}

/** Things only the Electron main process can do: key storage, file dialogs, swapping the database file. */
export interface BackupEnv {
  dir: string;
  appVersion: string;
  stagingPath: string;
  getKey(): Buffer | null;
  saveNewKey(key: Buffer): void;
  newKey(): Buffer;
  pickBackupFile(): Promise<string | null>;
  /** Closes the live database, installs the staged one, records the restore in it, and restarts the app. */
  applyRestore(stagingPath: string, info: { backupId: string; manifestJson: string; userId: number | null }): void;
}

/** Login state lives in the main process. The renderer never tells us who it is. */
export interface Session {
  user: User | null;
}

type Payload<C extends Channel> = z.infer<(typeof schemas)[C]>;
type Handler<C extends Channel> = (p: Payload<C>, s: Session) => unknown;

const PUBLIC: ReadonlySet<Channel> = new Set(['auth.status', 'auth.setupAdmin', 'auth.login', 'restore.prepare', 'restore.apply']);

export function createHandlers(ctx: Ctx, printer: Printer, backup?: BackupEnv) {
  const userId = (s: Session) => s.user!.id;
  let prepared: { stagingPath: string; backupId: string; manifestJson: string } | null = null;

  const needBackup = () => {
    if (!backup) throw new DomainError('VALIDATION', 'Backup is not available in this mode');
    return backup;
  };
  /** Restore is allowed for users with backup.restore, or on a fresh install before any user exists. */
  const canRestore = (s: Session) => userCount(ctx) === 0 || (s.user !== null && hasPermission(ctx, s.user.id, 'backup.restore'));

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
    'shift.close': (p, s) => {
      const summary = closeShift(ctx, userId(s), p.countedCash);
      // Day-end backup (plan §J). The shift is already closed; a backup failure only shows in backup status.
      const key = backup?.getKey();
      if (backup && key) {
        try {
          createBackup(ctx, { dir: backup.dir, masterKey: key, appVersion: backup.appVersion, trigger: 'shift_close', userId: userId(s) });
        } catch (e) {
          console.error('[backup] shift-close backup failed', e);
        }
      }
      return summary;
    },
    'cash.move': (p, s) => recordCashMovement(ctx, userId(s), p.kind, p.amount, p.reason),
    'catalog.lookup': (p) => lookup(ctx, p.code),
    'catalog.search': (p) => searchProducts(ctx, p.text),
    'catalog.create': (p, s) => createProduct(ctx, userId(s), p),
    'sale.finalize': (p, s) => {
      let discountApproverId: number | undefined;
      if (p.approver) discountApproverId = authenticate(ctx, p.approver.username, p.approver.pin).id;
      return finalizeSale(ctx, userId(s), { idempotencyKey: p.idempotencyKey, lines: p.lines, payments: p.payments, discountApproverId, customerId: p.customerId });
    },
    'sale.receipt': (p) => receiptData(ctx, p.saleId),
    'sale.print': async (p) => {
      await printer.printReceipt(receiptData(ctx, p.saleId), p.copy);
      return null;
    },
    'hold.create': (p, s) => holdBill(ctx, userId(s), p.label, { lines: p.lines, customerId: p.customerId }),
    'hold.list': () => listHeldBills(ctx),
    'hold.recall': (p, s) => {
      const bill = recallBill(ctx, userId(s), p.id);
      // Current product data; prices are the live ones, as for any new bill.
      return { customerId: bill.customerId, lines: bill.lines.map((l) => ({ product: getProduct(ctx, l.productId), qty: l.qty })).filter((l) => l.product?.active) };
    },
    'supplier.list': () => listSuppliers(ctx),
    'supplier.create': (p, s) => createSupplier(ctx, userId(s), p),
    'customer.find': (p) => findCustomers(ctx, p.text),
    'customer.create': (p, s) => createCustomer(ctx, userId(s), p),
    'grn.create': (p, s) => receiveGoods(ctx, userId(s), p),
    'report.stock': (p, s) => stockOnHand(ctx, userId(s), p.onlyLow),
    'report.sales': (p, s) => salesSummary(ctx, userId(s), p.fromDay, p.toDay),
    'import.dryRun': (p, s) => {
      requirePermission(ctx, userId(s), p.kind === 'products' ? 'product.manage' : 'supplier.manage');
      try {
        return p.kind === 'products' ? dryRunProducts(ctx, p.csv) : dryRunSuppliers(ctx, p.csv);
      } catch (e) {
        throw new DomainError('VALIDATION', (e as Error).message);
      }
    },
    'import.commit': (p, s) => (p.kind === 'products' ? importProducts(ctx, userId(s), p.csv, p.acceptWarnings) : importSuppliers(ctx, userId(s), p.csv)),
    'bill.removed': (p, s) => recordRemoval(ctx, userId(s), p.kind, p.lines),
    'report.voids': (p, s) => voidsReport(ctx, userId(s), p.fromDay, p.toDay),
    'user.list': (_p, s) => {
      requirePermission(ctx, userId(s), 'user.manage');
      return listUsers(ctx);
    },
    'user.create': (p, s) => createUser(ctx, userId(s), { username: p.username, displayName: p.displayName, pin: p.pin, roles: [p.role] }),
    'backup.status': () => ({ ...backupStatus(ctx), keyConfigured: !!backup?.getKey() }),
    'backup.setupKey': (_p, s) => {
      const b = needBackup();
      requirePermission(ctx, userId(s), 'settings.manage');
      if (b.getKey()) throw new DomainError('CONFLICT', 'A backup key already exists');
      const key = b.newKey();
      b.saveNewKey(key);
      appendAudit(ctx, { userId: userId(s), action: 'backup.key_created', entity: 'backup_key' });
      return { recoveryCode: keyToRecoveryCode(key) }; // shown once; never stored in plain text
    },
    'backup.run': (_p, s) => {
      const b = needBackup();
      const key = b.getKey();
      if (!key) throw new DomainError('VALIDATION', 'Set up the backup key first');
      const r = createBackup(ctx, { dir: b.dir, masterKey: key, appVersion: b.appVersion, trigger: 'manual', userId: userId(s) });
      return { fileName: r.fileName, createdAt: r.manifest.createdAt };
    },
    'restore.prepare': async (p, s) => {
      const b = needBackup();
      if (!canRestore(s)) throw new DomainError('PERMISSION_DENIED', 'Not allowed: backup.restore');
      const file = await b.pickBackupFile();
      if (!file) return null;
      const key = p.recoveryCode ? recoveryCodeToKeyOrFail(p.recoveryCode) : b.getKey();
      if (!key) throw new DomainError('VALIDATION', 'Enter the recovery code for this backup');
      try {
        const m = prepareRestore(file, key, b.stagingPath);
        prepared = { stagingPath: b.stagingPath, backupId: m.backupId, manifestJson: JSON.stringify({ ...m, wrap: undefined }) };
        if (p.recoveryCode && !b.getKey()) b.saveNewKey(key); // a replacement PC keeps using the same key
        return { backupId: m.backupId, createdAt: m.createdAt, lastInvoiceNo: m.lastInvoiceNo, counts: m.verifiedCounts };
      } catch (e) {
        throw new DomainError('VALIDATION', (e as Error).message);
      }
    },
    'restore.apply': (_p, s) => {
      const b = needBackup();
      if (!canRestore(s)) throw new DomainError('PERMISSION_DENIED', 'Not allowed: backup.restore');
      if (!prepared) throw new DomainError('VALIDATION', 'Check a backup file first');
      // Safety net: back up the current data before replacing it (if there is a key).
      const key = b.getKey();
      if (key && userCount(ctx) > 0) createBackup(ctx, { dir: b.dir, masterKey: key, appVersion: b.appVersion, trigger: 'pre_restore', userId: s.user?.id ?? null });
      const p = prepared;
      prepared = null;
      b.applyRestore(p.stagingPath, { backupId: p.backupId, manifestJson: p.manifestJson, userId: s.user?.id ?? null });
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

function recoveryCodeToKeyOrFail(code: string): Buffer {
  try {
    return recoveryCodeToKey(code);
  } catch (e) {
    throw new DomainError('VALIDATION', (e as Error).message);
  }
}
