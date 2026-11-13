import { appendAudit } from './audit';
import { applyCommands, commandCursor, type PosCommand } from './commerce-orders';
import { CloudError, cloudCall, normaliseUrl, type FetchFn } from './cloud-client';
import { storeDay } from '../core/store-time';
import type { Ctx } from './context';
import { requirePermission } from './users';

// The POS's side of the online store sync. It tells the website about physical stock and the catalogue.
// It is separate from dashboard-sync, which sends the owner's read-only figures. The two share nothing.
// It only ever reads the rows listed here, and never a cost column.

export interface CommerceCreds {
  url: string;
  deviceId: string;
  secret: string;
  /** Raised after a backup is restored, so the website treats what follows as a new stream. Kept outside the database. */
  epoch?: number;
}

export interface CommerceEvent {
  eventId: string;
  version: 1;
  occurredAt: string;
  type: 'stock.movement' | 'stock.checkpoint' | 'catalog.product' | 'catalog.category' | 'order.handed_over';
  payload: object;
}

export interface CommerceTransport {
  send(events: CommerceEvent[], pending?: number): Promise<{ ackedSeq: number; needCheckpoint?: boolean }>;
  /** Orders accepted or cancelled on the website, after the last one the POS has. */
  commands?(after: number): Promise<PosCommand[]>;
  ack?(ids: number[]): Promise<void>;
  /** How much the website holds for online orders, per product. */
  reserved?(): Promise<{ productId: number; reserved: number }[]>;
}

interface OutboxRow {
  seq: number;
  type: CommerceEvent['type'];
  row_id: number | null;
  payload: string | null;
  created_at: string;
}

const BATCH = 200;
const CHECKPOINT_PART = 2000;
const MAX_BATCHES_PER_ROUND = 50;
export const COMMERCE_ROUND_MS = 20_000;
const MAX_RETRY_MS = 300_000;

const setting = (ctx: Ctx, key: string) => (ctx.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string }).value;
const setSetting = (ctx: Ctx, key: string, value: string) => ctx.db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, key);

export const commerceEnabled = (ctx: Ctx): boolean => setting(ctx, 'commerce_enabled') === '1';

const clip = (s: string, max: number) => [...s].slice(0, max).join('');

function clearQueue(ctx: Ctx) {
  ctx.db.prepare('DELETE FROM commerce_outbox').run();
  ctx.db.prepare("DELETE FROM sqlite_sequence WHERE name = 'commerce_outbox'").run();
}

/** Everything the website needs to start, written in one transaction so no sale can slip between the parts. */
function enqueueFullLoad(ctx: Ctx) {
  ctx.db.prepare("INSERT INTO commerce_outbox (type, row_id) SELECT 'catalog.category', id FROM categories ORDER BY id").run();
  ctx.db.prepare("INSERT INTO commerce_outbox (type, row_id) SELECT 'catalog.product', id FROM products ORDER BY id").run();
  enqueueCheckpoint(ctx);
}

/** A full count of stock, in parts, written in one transaction so it matches one moment. */
function enqueueCheckpoint(ctx: Ctx) {
  const balances = ctx.db.prepare('SELECT p.id AS productId, COALESCE(b.qty, 0) AS qty FROM products p LEFT JOIN stock_balances b ON b.product_id = p.id ORDER BY p.id').all() as { productId: number; qty: number }[];
  const parts = Math.max(1, Math.ceil(balances.length / CHECKPOINT_PART));
  const insert = ctx.db.prepare("INSERT INTO commerce_outbox (type, payload) VALUES ('stock.checkpoint', ?)");
  for (let part = 1; part <= parts; part++) insert.run(JSON.stringify({ part, parts, balances: balances.slice((part - 1) * CHECKPOINT_PART, part * CHECKPOINT_PART) }));
}

/** Starts from an empty queue, numbered from one, because a new connection is new to the website. */
export function startCommerce(ctx: Ctx, userId: number): void {
  requirePermission(ctx, userId, 'settings.manage');
  ctx.db.transaction(() => {
    clearQueue(ctx);
    setSetting(ctx, 'commerce_enabled', '1');
    setSetting(ctx, 'commerce_last_error', '');
    enqueueFullLoad(ctx);
    setSetting(ctx, 'commerce_last_checkpoint_day', storeDay(ctx.now()));
    appendAudit(ctx, { userId, action: 'commerce.start', entity: 'commerce' });
  })();
}

/** After a backup restore the queue may hold events the website already has, or miss some. Start it again from one. */
export function restartAfterRestore(ctx: Ctx): void {
  if (!commerceEnabled(ctx)) return;
  ctx.db.transaction(() => {
    clearQueue(ctx);
    enqueueFullLoad(ctx);
    setSetting(ctx, 'commerce_last_checkpoint_day', storeDay(ctx.now()));
    appendAudit(ctx, { userId: null, action: 'commerce.restart_after_restore', entity: 'commerce' });
  })();
}

export function stopCommerce(ctx: Ctx, userId: number): void {
  requirePermission(ctx, userId, 'settings.manage');
  ctx.db.transaction(() => {
    setSetting(ctx, 'commerce_enabled', '0');
    clearQueue(ctx);
    appendAudit(ctx, { userId, action: 'commerce.stop', entity: 'commerce' });
  })();
}

function productPayload(ctx: Ctx, id: number): object {
  const p = ctx.db.prepare(`SELECT p.id, p.sku, p.name_en, p.name_ar, p.category_id, u.code AS unit, p.sell_mode, p.price_incl, p.vat_rate_bp, p.active
    FROM products p JOIN units u ON u.id = p.unit_id WHERE p.id = ?`).get(id) as { id: number; sku: string; name_en: string; name_ar: string; category_id: number | null; unit: string; sell_mode: string; price_incl: number; vat_rate_bp: number; active: number };
  const barcodes = (ctx.db.prepare('SELECT barcode FROM product_barcodes WHERE product_id = ? ORDER BY barcode LIMIT 50').all(id) as { barcode: string }[]).map((b) => b.barcode);
  return { productId: p.id, sku: p.sku, nameEn: clip(p.name_en, 200), nameAr: clip(p.name_ar, 200), categoryId: p.category_id, unit: p.unit, sellMode: p.sell_mode, itemKind: 'stock', priceIncl: p.price_incl, vatRateBp: p.vat_rate_bp, active: p.active === 1, barcodes };
}

function payloadOf(ctx: Ctx, row: OutboxRow): object {
  switch (row.type) {
    case 'stock.movement': {
      const m = ctx.db.prepare('SELECT id, product_id, qty, reason, source_type, source_id, source_line FROM stock_movements WHERE id = ?').get(row.row_id) as { id: number; product_id: number; qty: number; reason: string; source_type: string; source_id: number; source_line: number };
      const link = m.source_type === 'sale' ? (ctx.db.prepare('SELECT order_id FROM commerce_order_links WHERE sale_id = ?').get(m.source_id) as { order_id: string } | undefined) : undefined;
      return { movementId: m.id, productId: m.product_id, qty: m.qty, reason: m.reason, sourceType: m.source_type, sourceId: m.source_id, sourceLine: m.source_line, orderId: link?.order_id ?? null };
    }
    case 'catalog.category': {
      const c = ctx.db.prepare('SELECT id, name_en, name_ar FROM categories WHERE id = ?').get(row.row_id) as { id: number; name_en: string; name_ar: string };
      return { categoryId: c.id, nameEn: clip(c.name_en, 200), nameAr: clip(c.name_ar, 200) };
    }
    case 'catalog.product':
      return productPayload(ctx, row.row_id!);
    case 'order.handed_over': {
      const s = ctx.db.prepare('SELECT s.invoice_no, s.uuid, s.total_incl, s.created_at, l.order_id FROM sales s JOIN commerce_order_links l ON l.sale_id = s.id WHERE s.id = ?').get(row.row_id) as { invoice_no: string; uuid: string; total_incl: number; created_at: string; order_id: string };
      return { orderId: s.order_id, invoiceNo: s.invoice_no, saleUuid: s.uuid, totalIncl: s.total_incl, handedOverAt: s.created_at };
    }
    case 'stock.checkpoint': {
      const body = JSON.parse(row.payload!) as { part: number; parts: number };
      return { uptoSeq: row.seq - body.part, ...body };
    }
  }
}

/** Sends the next batch. What the website acknowledges is removed, and everything else stays to be sent again. */
export async function syncCommerceOnce(ctx: Ctx, transport: CommerceTransport, deviceId: string, epoch = 0): Promise<{ sent: number; ackedSeq: number; needCheckpoint: boolean }> {
  const rows = ctx.db.prepare('SELECT seq, type, row_id, payload, created_at FROM commerce_outbox ORDER BY seq LIMIT ?').all(BATCH) as OutboxRow[];
  if (rows.length === 0) return { sent: 0, ackedSeq: 0, needCheckpoint: false };
  const total = (ctx.db.prepare('SELECT count(*) AS n FROM commerce_outbox').get() as { n: number }).n;
  const events: CommerceEvent[] = rows.map((r) => ({ eventId: `${deviceId}:${epoch}:${r.seq}`, version: 1, occurredAt: r.created_at, type: r.type, payload: payloadOf(ctx, r) }));
  const { ackedSeq, needCheckpoint } = await transport.send(events, total - rows.length);
  ctx.db.prepare('DELETE FROM commerce_outbox WHERE seq <= ?').run(ackedSeq);
  return { sent: rows.length, ackedSeq, needCheckpoint: needCheckpoint === true };
}

/** One round, beside the till and never in its way. Failures show on the status screen and the queue waits. */
export async function commerceTick(ctx: Ctx, transport: CommerceTransport, deviceId: string, epoch = 0): Promise<{ ok: boolean }> {
  if (!commerceEnabled(ctx)) return { ok: true };
  try {
    // Once each store day, a full stock check, so small differences never last long.
    if (setting(ctx, 'commerce_last_checkpoint_day') !== storeDay(ctx.now())) {
      ctx.db.transaction(() => {
        enqueueCheckpoint(ctx);
        setSetting(ctx, 'commerce_last_checkpoint_day', storeDay(ctx.now()));
      })();
    }
    let need = false;
    const drain = async () => {
      let any = false;
      for (let i = 0; i < MAX_BATCHES_PER_ROUND; i++) {
        const r = await syncCommerceOnce(ctx, transport, deviceId, epoch);
        if (r.sent === 0) break;
        any = true;
        need = r.needCheckpoint;
        if (r.sent < BATCH) break;
      }
      return any;
    };
    if (!(await drain())) need = (await transport.send([], 0)).needCheckpoint === true; // tells the website the POS is still here
    // The website asks for a full stock check after a long silence or a restore. Send one if none is already waiting.
    if (need && !ctx.db.prepare("SELECT 1 FROM commerce_outbox WHERE type = 'stock.checkpoint'").get()) {
      ctx.db.transaction(() => enqueueCheckpoint(ctx))();
      await drain();
    }
    if (transport.commands && transport.ack) {
      const commands = await transport.commands(commandCursor(ctx));
      if (commands.length) {
        applyCommands(ctx, commands);
        await transport.ack(commands.map((c) => c.id));
      }
    }
    if (transport.reserved) {
      const totals = await transport.reserved();
      const known = ctx.db.prepare('SELECT 1 FROM products WHERE id = ?');
      ctx.db.transaction(() => {
        ctx.db.prepare('DELETE FROM commerce_reserved').run();
        const insert = ctx.db.prepare('INSERT INTO commerce_reserved (product_id, reserved, as_of) VALUES (?, ?, ?)');
        for (const t of totals) if (known.get(t.productId)) insert.run(t.productId, t.reserved, ctx.now());
      })();
    }
    setSetting(ctx, 'commerce_last_ok_at', ctx.now());
    setSetting(ctx, 'commerce_last_error', '');
    return { ok: true };
  } catch (e) {
    setSetting(ctx, 'commerce_last_error', clip((e as Error).message, 200));
    return { ok: false };
  }
}

/** The wait before the next try after this many failures in a row. */
export function commerceRetryDelayMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(MAX_RETRY_MS, COMMERCE_ROUND_MS * 2 ** Math.min(failures - 1, 10));
}

export interface CommerceStatus {
  enabled: boolean;
  pending: number;
  lastOkAt: string | null;
  lastError: string | null;
}

export function commerceStatus(ctx: Ctx): CommerceStatus {
  return {
    enabled: commerceEnabled(ctx),
    pending: (ctx.db.prepare('SELECT count(*) AS n FROM commerce_outbox').get() as { n: number }).n,
    lastOkAt: setting(ctx, 'commerce_last_ok_at') || null,
    lastError: setting(ctx, 'commerce_last_error') || null,
  };
}

export async function enrollCommerce(fetchFn: FetchFn, url: string, input: { code: string; deviceName: string; appVersion: string }): Promise<CommerceCreds> {
  const base = normaliseUrl(url);
  const r = (await (await cloudCall(fetchFn, `${base}/api/device/commerce/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })).json()) as { deviceId: string; deviceSecret: string };
  if (!r.deviceId || !r.deviceSecret) throw new CloudError('The website did not answer as expected', 'remote', 'BAD_ANSWER');
  return { url: base, deviceId: r.deviceId, secret: r.deviceSecret };
}

export function makeCommerceTransport(creds: CommerceCreds, fetchFn: FetchFn): CommerceTransport {
  const auth = { authorization: `Bearer ${creds.deviceId}.${creds.secret}` };
  return {
    commands: async (after) => ((await (await cloudCall(fetchFn, `${creds.url}/api/device/commerce/commands?after=${after}`, { headers: auth })).json()) as { commands: PosCommand[] }).commands,
    ack: async (ids) => void (await cloudCall(fetchFn, `${creds.url}/api/device/commerce/commands/ack`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ ids }) })),
    send: async (events, pending = 0) => (await (await cloudCall(fetchFn, `${creds.url}/api/device/commerce/events`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ events, pending }) })).json()) as { ackedSeq: number; needCheckpoint?: boolean },
    reserved: async () => ((await (await cloudCall(fetchFn, `${creds.url}/api/device/commerce/reserved`, { headers: auth })).json()) as { totals: { productId: number; reserved: number }[] }).totals,
  };
}
