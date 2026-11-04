import { contextBridge, ipcRenderer } from 'electron';

// Sandboxed preload: it may only require 'electron', so the allowlist is repeated here.
// src/main/ipc.test.ts checks it matches src/shared/ipc.ts exactly.
const PRELOAD_CHANNELS = [
  'auth.status',
  'auth.setupAdmin',
  'auth.login',
  'auth.logout',
  'shift.current',
  'shift.open',
  'shift.close',
  'cash.move',
  'catalog.lookup',
  'catalog.search',
  'catalog.create',
  'sale.finalize',
  'sale.receipt',
  'sale.print',
  'hold.create',
  'hold.list',
  'hold.recall',
  'supplier.list',
  'supplier.create',
  'customer.find',
  'customer.create',
  'grn.create',
  'report.stock',
  'report.sales',
  'import.dryRun',
  'import.commit',
  'bill.removed',
  'report.voids',
  'user.list',
  'user.create',
  'backup.status',
  'backup.setupKey',
  'backup.run',
  'restore.prepare',
  'restore.apply',
] as const;

const allowed = new Set<string>(PRELOAD_CHANNELS);

contextBridge.exposeInMainWorld('pos', {
  invoke: (channel: string, payload: unknown) => {
    if (!allowed.has(channel)) return Promise.reject(new Error(`Blocked channel ${channel}`));
    return ipcRenderer.invoke(`pos:${channel}`, payload ?? null);
  },
});
