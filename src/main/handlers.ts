import type { z } from 'zod';
import { schemas, type Channel, type IpcResult } from '../shared/ipc';
import { backupStatus, createBackup, prepareRestore } from '../services/backup';
import { keyToRecoveryCode, recoveryCodeToKey } from '../services/backup-crypto';
import { getShortcuts, saveShortcuts } from '../services/shortcuts';
import { billProductCost, createSupplierBill, findSupplierItem, getBill, listBills, priceHistory, purchasesBySupplier, supplierItemsFor } from '../services/supplier-bills';
import { getStoreDetails, saveStoreDetails } from '../services/store-details';
import { createProduct, getAliases, itemInfo, listProducts, lookup, saveScaleLayout, scaleLayouts, searchProducts, setAliases, setPrice, setProductActive } from '../services/catalog';
import { searchProducts as indexedSearch } from '../services/search';
import { DomainError, type Ctx } from '../services/context';
import { appendAudit, verifyAuditChain } from '../services/audit';
import { clearDraft, discardDraft, loadDraft, markDraftRestored, saveDraft } from '../services/drafts';
import { cancelHeldBill, holdBill, hydrateBill, listHeldBills, payloadSchema, recallBill, recordRemoval } from '../services/held-bills';
import { dryRunProducts, dryRunSuppliers, importProducts, importSuppliers } from '../services/import';
import { receiveGoods } from '../services/inventory';
import { createCustomer, createSupplier, findCustomers, listSuppliers, updateSupplier } from '../services/parties';
import { adjustmentsReport, cashierActivity, refundsReport, salesSummary, stockOnHand, voidsReport } from '../services/reports';
import { createRefund, findSaleForRefund, recentSales, refundReceiptData } from '../services/refunds';
import { postStockCount, recordWastage } from '../services/adjustments';
import {
  cancelDraft, categoryAccounts, createExpense, expensePayments, expenseSummary, generateRecurring, getExpense, listCategories, listExpenses,
  listRecurring, payExpense, postExpense, reverseExpense, reversePayment, saveCategory, saveRecurring, updateDraft,
} from '../services/expenses';
import { balanceSheet, datedTrialBalance, generalLedger, ownerKpis, profitAndLoss } from '../services/financials';
import { syncHealth } from '../services/dashboard-sync';
import {
  createPurchaseInvoice, createPurchaseReturn, listPurchaseReturns, paySupplier, purchaseRegister, reverseSupplierPayment, setSupplierOpeningBalance,
  supplierAgeing, supplierBalances, supplierStatement, uninvoicedGrns,
} from '../services/purchasing';
import { vatSummary } from '../services/vat-report';
import {
  applyCustomerAdvance, creditControls, creditReceiptData, customerAccount, customerStatement, findCreditCustomers, listCustomerAccounts, receivablesAgeing,
  recordCustomerReceipt, reverseCustomerReceipt, setInvoiceDispute, suggestCustomerAllocation, updateCustomerCredit, writeOffInvoice,
} from '../services/credit';
import { applySupplierAdvance, setSupplierNotes, supplierAccount, supplierControls } from '../services/purchasing';
import { finalizeSale, receiptData, type ReceiptData } from '../services/sales';
import { closeShift, listShifts, openShift, openShiftId, recordCashMovement, shiftSummary } from '../services/shifts';
import { authenticate, createUser, hasPermission, listUsers, requirePermission, setUserActive, userCount, type User } from '../services/users';

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
    'shift.history': (p, s) => listShifts(ctx, userId(s), p.limit),
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
    'catalog.suggest': (p) => indexedSearch(ctx, p.text, [...p.text.trim()].length <= 1 ? 8 : 12),
    'supplier.update': (p, s) => {
      const { id, ...fields } = p;
      updateSupplier(ctx, userId(s), id, fields);
      return null;
    },
    'bill.create': (p, s) => createSupplierBill(ctx, userId(s), p),
    'bill.list': (p, s) => listBills(ctx, userId(s), p.fromDay, p.toDay),
    'bill.get': (p, s) => getBill(ctx, userId(s), p.id),
    'bill.priceHistory': (p, s) => priceHistory(ctx, userId(s), p.productId),
    'bill.bySupplier': (p, s) => purchasesBySupplier(ctx, userId(s), p.fromDay, p.toDay),
    'bill.productCost': (p, s) => billProductCost(ctx, userId(s), p.productId),
    'bill.item': (p, s) => {
      requirePermission(ctx, userId(s), 'stock.receive');
      return findSupplierItem(ctx, p.supplierId, p.code);
    },
    'bill.items': (p, s) => {
      requirePermission(ctx, userId(s), 'stock.receive');
      return supplierItemsFor(ctx, p.supplierId);
    },
    'store.get': (_p, s) => {
      requirePermission(ctx, userId(s), 'settings.manage');
      return getStoreDetails(ctx);
    },
    'store.save': (p, s) => saveStoreDetails(ctx, userId(s), p),
    'shortcuts.get': () => getShortcuts(ctx),
    'shortcuts.save': (p, s) => saveShortcuts(ctx, userId(s), p.overrides),
    'catalog.list': (p, s) => listProducts(ctx, userId(s), p),
    'catalog.itemInfo': (p) => itemInfo(ctx, p.productId),
    'catalog.setPrice': (p, s) => setPrice(ctx, userId(s), p.productId, p.priceIncl),
    'catalog.setActive': (p, s) => setProductActive(ctx, userId(s), p.productId, p.active, p.reason),
    'catalog.aliases': (p, s) => {
      requirePermission(ctx, userId(s), 'product.manage');
      return getAliases(ctx, p.productId);
    },
    'catalog.setAliases': (p, s) => setAliases(ctx, userId(s), p.productId, p.aliases),
    'sale.finalize': (p, s) => {
      let discountApproverId: number | undefined;
      if (p.approver) discountApproverId = authenticate(ctx, p.approver.username, p.approver.pin).id;
      const creditApproverId = p.creditApprover ? authenticate(ctx, p.creditApprover.username, p.creditApprover.pin).id : undefined;
      return finalizeSale(ctx, userId(s), { idempotencyKey: p.idempotencyKey, lines: p.lines, payments: p.payments, discountApproverId, creditApproverId, customerId: p.customerId });
    },
    'sale.receipt': (p) => receiptData(ctx, p.saleId),
    'sale.print': async (p, s) => {
      const data = receiptData(ctx, p.saleId);
      // Reprints are recorded (who, which invoice) for the cashier activity report. A reprint never creates a sale.
      if (p.copy) appendAudit(ctx, { userId: userId(s), action: 'sale.reprint', entity: 'sale', entityId: p.saleId, details: { invoiceNo: data.invoiceNo } });
      await printer.printReceipt(data, p.copy);
      return null;
    },
    'hold.create': (p, s) => holdBill(ctx, userId(s), p.label, { lines: p.lines, customerId: p.customerId, billKey: p.billKey, cash: p.cash, card: p.card }),
    'hold.list': () => listHeldBills(ctx),
    'hold.recall': (p, s) => hydrateBill(ctx, recallBill(ctx, userId(s), p.id)),
    'hold.cancel': (p, s) => cancelHeldBill(ctx, userId(s), p.id, p.reason),
    'draft.get': (p, s) => {
      const d = loadDraft(ctx, userId(s), p.kind);
      if (!d) return null;
      return p.kind === 'sale' ? { bill: hydrateBill(ctx, payloadSchema.parse(JSON.parse(d.json))) } : { json: d.json };
    },
    'draft.save': (p, s) => saveDraft(ctx, userId(s), p.kind, p.json),
    'draft.clear': (p, s) => clearDraft(ctx, userId(s), p.kind),
    'draft.discard': (p, s) => discardDraft(ctx, userId(s), p.kind),
    'draft.restored': (p, s) => markDraftRestored(ctx, userId(s), p.kind),
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
    'bill.removed': (p, s) => recordRemoval(ctx, userId(s), p.kind, p.billKey, p.lines),
    'report.voids': (p, s) => voidsReport(ctx, userId(s), p.fromDay, p.toDay),
    'user.list': (_p, s) => {
      requirePermission(ctx, userId(s), 'user.manage');
      return listUsers(ctx);
    },
    'user.setActive': (p, s) => setUserActive(ctx, userId(s), p.userId, p.active),
    'report.cashiers': (p, s) => cashierActivity(ctx, userId(s), p.fromDay, p.toDay),
    'system.health': (_p, s) => {
      requirePermission(ctx, userId(s), 'reports.view');
      const broken = verifyAuditChain(ctx);
      return { auditChainOk: broken === null, firstBrokenAuditId: broken };
    },
    'scale.layouts': (_p, s) => {
      requirePermission(ctx, userId(s), 'settings.manage');
      return scaleLayouts(ctx);
    },
    'scale.saveLayout': (p, s) => saveScaleLayout(ctx, userId(s), p),
    'expense.categories': (_p, s) => listCategories(ctx, userId(s)),
    'expense.accounts': (_p, s) => categoryAccounts(ctx, userId(s)),
    'expense.saveCategory': (p, s) => saveCategory(ctx, userId(s), p),
    'expense.list': (p, s) => {
      // Opening the list creates the drafts of recurring expenses that have started (never posts or pays them).
      if (hasPermission(ctx, userId(s), 'expense.create')) generateRecurring(ctx, userId(s));
      return listExpenses(ctx, userId(s), p);
    },
    'expense.summary': (p, s) => expenseSummary(ctx, userId(s), p.fromDay, p.toDay),
    'expense.get': (p, s) => {
      requirePermission(ctx, userId(s), 'expense.view');
      return { expense: getExpense(ctx, p.id), payments: expensePayments(ctx, userId(s), p.id) };
    },
    'expense.create': (p, s) => createExpense(ctx, userId(s), p),
    'expense.update': (p, s) => {
      const { id, ...fields } = p;
      updateDraft(ctx, userId(s), id, fields);
      return null;
    },
    'expense.cancel': (p, s) => cancelDraft(ctx, userId(s), p.id, p.reason),
    'expense.post': (p, s) => postExpense(ctx, userId(s), p.id, p.payNow),
    'expense.pay': (p, s) => payExpense(ctx, userId(s), p.id, p),
    'expense.reversePayment': (p, s) => reversePayment(ctx, userId(s), p.paymentId, p.requestKey, p.reason),
    'expense.reverse': (p, s) => reverseExpense(ctx, userId(s), p.id, p.reason),
    'expense.recurring': (_p, s) => listRecurring(ctx, userId(s)),
    'expense.saveRecurring': (p, s) => saveRecurring(ctx, userId(s), p),
    'finance.pl': (p, s) => profitAndLoss(ctx, userId(s), p.fromDay, p.toDay),
    'finance.bs': (p, s) => balanceSheet(ctx, userId(s), p.asOf),
    'finance.tb': (p, s) => datedTrialBalance(ctx, userId(s), p.fromDay, p.toDay),
    'finance.gl': (p, s) => generalLedger(ctx, userId(s), p.code, p.fromDay, p.toDay),
    'finance.kpis': (p, s) => ownerKpis(ctx, userId(s), p.fromDay, p.toDay),
    'purchase.uninvoiced': (p, s) => uninvoicedGrns(ctx, userId(s), p.supplierId),
    'purchase.invoice': (p, s) => createPurchaseInvoice(ctx, userId(s), p),
    'purchase.returns': (p, s) => listPurchaseReturns(ctx, userId(s), p.limit),
    'purchase.return': (p, s) => createPurchaseReturn(ctx, userId(s), p),
    'purchase.opening': (p, s) => setSupplierOpeningBalance(ctx, userId(s), p),
    'purchase.pay': (p, s) => paySupplier(ctx, userId(s), p),
    'purchase.reversePayment': (p, s) => reverseSupplierPayment(ctx, userId(s), p.paymentId, p.requestKey, p.reason),
    'purchase.statement': (p, s) => supplierStatement(ctx, userId(s), p.supplierId),
    'purchase.ageing': (p, s) => supplierAgeing(ctx, userId(s), p.asOf),
    'purchase.register': (p, s) => purchaseRegister(ctx, userId(s), p.fromDay, p.toDay),
    'purchase.balances': (_p, s) => supplierBalances(ctx, userId(s)),
    'finance.vat': (p, s) => vatSummary(ctx, userId(s), p.fromDay, p.toDay),
    'credit.list': (p, s) => listCustomerAccounts(ctx, userId(s), p),
    'credit.find': (p, s) => findCreditCustomers(ctx, userId(s), p.text),
    'credit.account': (p, s) => customerAccount(ctx, userId(s), p.customerId),
    'credit.settings': (p, s) => updateCustomerCredit(ctx, userId(s), p),
    'credit.receipt': (p, s) => recordCustomerReceipt(ctx, userId(s), p),
    'credit.suggest': (p, s) => suggestCustomerAllocation(ctx, userId(s), p.customerId, p.amount),
    'credit.applyAdvance': (p, s) => applyCustomerAdvance(ctx, userId(s), p.customerId, p.allocations),
    'credit.reverseReceipt': (p, s) => reverseCustomerReceipt(ctx, userId(s), p.receiptId, p.requestKey, p.reason),
    'credit.writeOff': (p, s) => writeOffInvoice(ctx, userId(s), p),
    'credit.dispute': (p, s) => setInvoiceDispute(ctx, userId(s), p.saleId, p.disputed, p.note),
    'credit.statement': (p, s) => customerStatement(ctx, userId(s), p.customerId),
    'credit.ageing': (_p, s) => receivablesAgeing(ctx, userId(s)),
    'credit.printReceipt': async (p, s) => {
      requirePermission(ctx, userId(s), 'customer.payment.record');
      const data = creditReceiptData(ctx, p.receiptId);
      if (p.copy) appendAudit(ctx, { userId: userId(s), action: 'customer.receipt_reprint', entity: 'customer_receipt', entityId: p.receiptId, details: { receiptNo: data.invoiceNo } });
      await printer.printReceipt(data, p.copy);
      return null;
    },
    'credit.controls': (_p, s) => {
      requirePermission(ctx, userId(s), 'finance.view');
      return { customers: creditControls(ctx), suppliers: supplierControls(ctx) };
    },
    'purchase.account': (p, s) => supplierAccount(ctx, userId(s), p.supplierId),
    'purchase.applyAdvance': (p, s) => applySupplierAdvance(ctx, userId(s), p.supplierId, p.allocations),
    'purchase.notes': (p, s) => setSupplierNotes(ctx, userId(s), p.supplierId, p.notes),
    'dashboard.health': (_p, s) => {
      requirePermission(ctx, userId(s), 'settings.manage');
      return syncHealth(ctx);
    },
    'refund.recent': (p, s) => recentSales(ctx, userId(s), p),
    'refund.find': (p, s) => findSaleForRefund(ctx, userId(s), p.invoiceNo),
    'refund.create': (p, s) => {
      let approverId: number | undefined;
      if (p.approver) approverId = authenticate(ctx, p.approver.username, p.approver.pin).id;
      return createRefund(ctx, userId(s), { requestKey: p.requestKey, invoiceNo: p.invoiceNo, reason: p.reason, lines: p.lines, approverId });
    },
    'refund.print': async (p, s) => {
      requirePermission(ctx, userId(s), 'sale.create');
      const data = refundReceiptData(ctx, p.refundId);
      if (p.copy) appendAudit(ctx, { userId: userId(s), action: 'refund.reprint', entity: 'refund', entityId: p.refundId, details: { refundNo: data.invoiceNo } });
      await printer.printReceipt(data, p.copy);
      return null;
    },
    'stock.waste': (p, s) => recordWastage(ctx, userId(s), p),
    'stock.count': (p, s) => postStockCount(ctx, userId(s), p),
    'report.refunds': (p, s) => refundsReport(ctx, userId(s), p.fromDay, p.toDay),
    'report.adjustments': (p, s) => adjustmentsReport(ctx, userId(s), p.fromDay, p.toDay),
    'user.create': (p, s) => createUser(ctx, userId(s), { username: p.username, displayName: p.displayName, pin: p.pin, roles: [p.role] }),
    'backup.status': () => ({ ...backupStatus(ctx), keyConfigured: !!backup?.getKey() }),
    'backup.setupKey': (_p, s) => {
      requirePermission(ctx, userId(s), 'settings.manage');
      const b = needBackup();
      if (b.getKey()) throw new DomainError('CONFLICT', 'A backup key already exists');
      const key = b.newKey();
      b.saveNewKey(key);
      appendAudit(ctx, { userId: userId(s), action: 'backup.key_created', entity: 'backup_key' });
      return { recoveryCode: keyToRecoveryCode(key) }; // shown once; never stored in plain text
    },
    'backup.run': (_p, s) => {
      requirePermission(ctx, userId(s), 'backup.run');
      const b = needBackup();
      const key = b.getKey();
      if (!key) throw new DomainError('VALIDATION', 'Set up the backup key first');
      const r = createBackup(ctx, { dir: b.dir, masterKey: key, appVersion: b.appVersion, trigger: 'manual', userId: userId(s) });
      return { fileName: r.fileName, createdAt: r.manifest.createdAt };
    },
    'restore.prepare': async (p, s) => {
      if (!canRestore(s)) throw new DomainError('PERMISSION_DENIED', 'Not allowed: backup.restore'); // permission before anything else
      const b = needBackup();
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
      if (!canRestore(s)) throw new DomainError('PERMISSION_DENIED', 'Not allowed: backup.restore'); // permission before anything else
      const b = needBackup();
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
      return {
        ok: false,
        code: 'INTERNAL',
        message: c === 'sale.finalize' ? 'Sale NOT saved. Nothing was recorded. Try again.' : c === 'refund.create' ? 'Refund NOT saved. Do not pay out cash. Try again.' : 'Unexpected error',
      };
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
