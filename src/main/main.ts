import { BrowserWindow, app, ipcMain, session } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../db/connection';
import { makeCtx } from '../services/context';
import { CHANNELS } from '../shared/ipc';
import { createHandlers, type Printer, type Session } from './handlers';
import { receiptHtml } from './receipt-html';

// One instance only: two processes must never write the same SQLite file.
if (!app.requestSingleInstanceLock()) app.quit();

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

app.whenReady().then(() => {
  ctx = makeCtx(openDatabase(join(app.getPath('userData'), 'pos.db')));
  const dispatch = createHandlers(ctx, printer);
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
  win.webContents.on('destroyed', () => sessions.delete(win.webContents.id));
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
