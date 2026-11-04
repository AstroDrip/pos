import { BrowserWindow, app, dialog, ipcMain, safeStorage, session } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../db/connection';
import { makeCtx } from '../services/context';
import { CHANNELS } from '../shared/ipc';
import { appendAudit } from '../services/audit';
import { backupStatus, createBackup, encryptedSnapshot, installRestore } from '../services/backup';
import { createHandlers, type BackupEnv, type Printer, type Session } from './handlers';
import { receiptHtml } from './receipt-html';


const RENDERER_INDEX = join(__dirname, '..', '..', 'renderer', 'index.html');
const RENDERER_URL = pathToFileURL(RENDERER_INDEX).href;

/** Settings every window gets: no Node, isolated, sandboxed (plan §G; Electron security checklist). */
const SECURE_PREFS = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  spellcheck: false,
} as const;

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (ev) => ev.preventDefault());
  contents.on('will-redirect', (ev) => ev.preventDefault());
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

// Diagnostics/testing only: keep app data in another folder, and write receipts to a file instead of printing.
if (process.env.POS_USER_DATA) app.setPath('userData', process.env.POS_USER_DATA);

// One instance per data folder: two processes must never write the same SQLite file.
// (Must come after the userData path is final; the lock is tied to it.)
if (!app.requestSingleInstanceLock()) app.quit();
const RECEIPT_TO_FILE = process.env.POS_RECEIPT_TO_FILE;

const printer: Printer = {
  async printReceipt(data, copy) {
    const db = ctx.db;
    const get = (k: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value ?? '';
    const html = receiptHtml(data, { nameAr: get('store_name_ar'), nameEn: get('store_name_en'), vatNumber: get('store_vat_number') }, copy);
    if (RECEIPT_TO_FILE) return writeFileSync(RECEIPT_TO_FILE, html, 'utf8');
    const win = new BrowserWindow({ show: false, webPreferences: { ...SECURE_PREFS, javascript: false } });
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await new Promise<void>((resolve, reject) =>
        win.webContents.print({ silent: true, printBackground: false }, (ok, reason) => (ok ? resolve() : reject(new Error(reason)))),
      );
    } finally {
      win.destroy();
    }
  },
};

let ctx: ReturnType<typeof makeCtx>;
let mainWindow: BrowserWindow | null = null;

const BACKUP_EVERY_MS = 4 * 60 * 60 * 1000;

function makeBackupEnv(dataDir: string, dbPath: string): BackupEnv {
  const keyPath = join(dataDir, 'backup-key.bin');
  const dir = join(dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  return {
    dir,
    appVersion: app.getVersion(),
    stagingPath: join(dataDir, 'restore-staging.db'),
    // The backup key is protected with Windows DPAPI via safeStorage; it is never written in plain text.
    getKey() {
      if (!existsSync(keyPath)) return null;
      return Buffer.from(safeStorage.decryptString(readFileSync(keyPath)), 'base64');
    },
    saveNewKey(key) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is not available');
      writeFileSync(keyPath, safeStorage.encryptString(key.toString('base64')));
    },
    newKey: () => randomBytes(32),
    async pickBackupFile() {
      if (process.env.POS_RESTORE_FILE) return process.env.POS_RESTORE_FILE; // automated tests only
      const r = await dialog.showOpenDialog(mainWindow!, {
        title: 'Choose a backup file',
        defaultPath: dir,
        filters: [{ name: 'POS backup', extensions: ['posbak'] }],
        properties: ['openFile'],
      });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    applyRestore(stagingPath, info) {
      ctx.db.close();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      installRestore(dbPath, stagingPath, stamp);
      const restored = makeCtx(openDatabase(dbPath));
      restored.db.transaction(() => {
        restored.db
          .prepare('INSERT INTO restore_events (at, user_id, backup_id, manifest_json) VALUES (?, ?, ?, ?)')
          .run(restored.now(), null, info.backupId, info.manifestJson);
        appendAudit(restored, { userId: null, action: 'backup.restore', entity: 'backup', entityId: info.backupId, details: { restoredByUserIdInOldDb: info.userId } });
      })();
      restored.db.close();
      if (!process.env.POS_NO_RELAUNCH) app.relaunch(); // automated tests restart the app themselves
      app.exit(0);
    },
  };
}

app.whenReady().then(() => {
  const dataDir = app.getPath('userData');
  const dbPath = join(dataDir, 'pos.db');
  const backupEnv = makeBackupEnv(dataDir, dbPath);
  ctx = makeCtx(
    openDatabase(dbPath, {
      // Encrypted when a backup key exists; otherwise the plain default (no key means no encrypted backups at all yet).
      preMigrationSnapshot: (db, version) => {
        const key = backupEnv.getKey();
        if (key) encryptedSnapshot(db, backupEnv.dir, key, backupEnv.appVersion, `pre-v${version}`);
        else db.prepare('VACUUM INTO ?').run(`${dbPath}.pre-v${version}-${Date.now()}.db`);
      },
    }),
  );
  const dispatch = createHandlers(ctx, printer, backupEnv);

  // Scheduled local backup while the app is open (plan §J). Failures show in backup status.
  setInterval(() => {
    try {
      const key = backupEnv.getKey();
      const last = backupStatus(ctx).lastVerifiedLocal;
      if (key && ctx.db.open && (!last || Date.now() - Date.parse(last.at) > BACKUP_EVERY_MS)) {
        createBackup(ctx, { dir: backupEnv.dir, masterKey: key, appVersion: backupEnv.appVersion, trigger: 'scheduled', userId: null });
      }
    } catch (e) {
      console.error('[backup] scheduled backup failed', e);
    }
  }, 15 * 60 * 1000);
  const sessions = new Map<number, Session>();

  // Deny camera, mic, notifications, etc. The POS needs none of them.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  for (const channel of CHANNELS) {
    ipcMain.handle(`pos:${channel}`, (event, payload) => {
      // Only our own top-level page may call in.
      if (event.senderFrame?.url !== RENDERER_URL || event.senderFrame.parent) {
        return { ok: false, code: 'FORBIDDEN', message: 'Forbidden' };
      }
      const id = event.sender.id;
      if (!sessions.has(id)) sessions.set(id, { user: null });
      return dispatch(channel, payload, sessions.get(id)!);
    });
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: 'POS',
    webPreferences: { ...SECURE_PREFS, preload: join(__dirname, '..', 'preload', 'preload.js') },
  });
  mainWindow = win;
  const wcId = win.webContents.id;
  win.webContents.on('destroyed', () => sessions.delete(wcId));
  win.once('ready-to-show', () => win.show());
  void win.loadFile(RENDERER_INDEX);
});

app.on('window-all-closed', () => {
  if (ctx?.db.open) {
    ctx.db.pragma('wal_checkpoint(TRUNCATE)');
    ctx.db.close();
  }
  app.quit();
});
