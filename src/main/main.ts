import { BrowserWindow, app, dialog, ipcMain, net, safeStorage, session } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../db/connection';
import { makeCtx } from '../services/context';
import { CHANNELS } from '../shared/ipc';
import { appendAudit } from '../services/audit';
import { backupStatus, createBackup, encryptedSnapshot, installRestore } from '../services/backup';
import { createHandlers, type BackupEnv, type CloudEnv, type Printer, type Session } from './handlers';
import { makeCloudApi, type CloudCreds } from '../services/cloud-client';
import { cloudTick } from '../services/cloud-jobs';
import { paperWidth } from '../services/hardware';
import { startupMessage } from './startup-error';
import { getStoreDetails } from '../services/store-details';
import { runUiAudit } from './ui-audit';
import { demandScores } from '../services/demand';
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
    await printHtml(receiptHtml(data, getStoreDetails(ctx), copy, paperWidth(ctx)));
  },
  listPrinters: async () => {
    const list = (await mainWindow?.webContents.getPrintersAsync()) ?? [];
    return list.map((p) => ({ name: p.name, isDefault: !!(p as { isDefault?: boolean }).isDefault }));
  },
  async printTest(data, device) {
    await printHtml(receiptHtml(data, getStoreDetails(ctx), false, paperWidth(ctx)), device);
  },
};

async function printHtml(html: string, deviceName?: string): Promise<void> {
  if (RECEIPT_TO_FILE) return writeFileSync(RECEIPT_TO_FILE, html, 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { ...SECURE_PREFS, javascript: false } });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise<void>((resolve, reject) =>
      win.webContents.print({ silent: true, printBackground: false, ...(deviceName ? { deviceName } : {}) }, (ok, reason) => (ok ? resolve() : reject(new Error(reason)))),
    );
  } finally {
    win.destroy();
  }
}

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

/** The device credential is protected by Windows and kept out of the database, so no backup ever contains it. */
function makeCloudEnv(dataDir: string): CloudEnv {
  const file = join(dataDir, 'cloud-device.bin');
  return {
    getCreds() {
      if (!existsSync(file)) return null;
      try {
        return JSON.parse(safeStorage.decryptString(readFileSync(file))) as CloudCreds;
      } catch {
        return null; // from another Windows user or computer: this device has to connect again
      }
    },
    saveCreds(c) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is not available');
      writeFileSync(file, safeStorage.encryptString(JSON.stringify(c)));
    },
    clearCreds: () => rmSync(file, { force: true }),
    fetch: (url, init) => net.fetch(url, init),
  };
}

const CLOUD_ROUND_MS = 5 * 60 * 1000;

app.whenReady().then(() => {
  const dataDir = app.getPath('userData');
  const dbPath = join(dataDir, 'pos.db');
  const backupEnv = makeBackupEnv(dataDir, dbPath);
  try {
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
  } catch (e) {
    const m = startupMessage(e, dataDir);
    dialog.showErrorBox(m.title, m.body);
    app.exit(1);
    return;
  }
  const cloudEnv = makeCloudEnv(dataDir);
  const dispatch = createHandlers(ctx, printer, backupEnv, cloudEnv);
  // Cloud round: never on the checkout path, and at most one at a time.
  let cloudBusy = false;
  const cloudRound = () => {
    if (cloudBusy || !ctx.db.open) return;
    cloudBusy = true;
    void cloudTick(ctx, {
      dir: backupEnv.dir,
      stagingPath: backupEnv.stagingPath,
      appVersion: backupEnv.appVersion,
      getKey: () => backupEnv.getKey(),
      api: () => {
        const c = cloudEnv.getCreds();
        return c ? makeCloudApi(c, cloudEnv.fetch, backupEnv.appVersion) : null;
      },
    })
      .catch((e: unknown) => console.error('[cloud] round failed', (e as Error).name))
      .finally(() => (cloudBusy = false));
  };
  setTimeout(cloudRound, 60_000);
  setInterval(cloudRound, CLOUD_ROUND_MS);
  // Read 90 days of sales once now, so the first search does not pay for it (later updates are incremental).
  setTimeout(() => {
    try {
      demandScores(ctx);
    } catch {
      // ranking falls back to name order until the next search computes it
    }
  }, 0);

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
  // Development-only UI audit (scripts/ui-audit.mjs). Never active in a packaged build.
  const auditDir = process.env.POS_UI_AUDIT;
  if (auditDir && !app.isPackaged) {
    const [username = '', pin = ''] = (process.env.POS_UI_AUDIT_LOGIN ?? '').split(':');
    void runUiAudit(win, auditDir, {
      salesCount: () => (ctx.db.prepare('SELECT count(*) AS n FROM sales').get() as { n: number }).n,
      login: { username, pin },
    });
  }
});

app.on('window-all-closed', () => {
  if (ctx?.db.open) {
    ctx.db.pragma('wal_checkpoint(TRUNCATE)');
    ctx.db.close();
  }
  app.quit();
});
