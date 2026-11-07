/**
 * Development-only UI audit. Runs ONLY when POS_UI_AUDIT=<folder> is set and the app is not packaged (see main.ts).
 * Uses Electron's own APIs (executeJavaScript, sendInputEvent, capturePage); no browser-automation framework.
 * Writes screenshots, geometry findings and key-flow results into the folder, then quits the app.
 * Always run it against a temporary data folder with fake data (scripts/ui-audit.mjs does this).
 */
import { app, type BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditGeometry, type Finding, type Snapshot } from '../core/geometry-audit';
import { CLEAR_OUTLINE_SOURCE, COLLECT_SOURCE, outlineSource } from './ui-audit-collect';

export interface UiAuditHooks {
  /** Number of finalised sales in the (temporary) database: used to prove a key never created a sale. */
  salesCount(): number;
  login: { username: string; pin: string };
}

interface FlowResult { flow: string; ok: boolean; detail: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runUiAudit(win: BrowserWindow, outDir: string, hooks: UiAuditHooks): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const wc = win.webContents;
  const js = <T = unknown>(code: string): Promise<T> => wc.executeJavaScript(code, true) as Promise<T>;
  const waitFor = async (expr: string, ms = 4000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await js<boolean>(`!!(${expr})`)) return true;
      await sleep(50);
    }
    return false;
  };
  const key = (keyCode: string, modifiers: ('shift' | 'control')[] = []) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
    else if (keyCode.length === 1) wc.sendInputEvent({ type: 'char', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  };
  const type = async (text: string, gapMs = 0) => {
    for (const ch of text) {
      key(ch);
      if (gapMs) await sleep(gapMs);
    }
  };
  const focus = (selector: string) => js<boolean>(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.focus(); return true; })()`);
  const click = (selector: string, text?: string) =>
    js<boolean>(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(selector)})]; const e = ${text === undefined ? 'els[0]' : `els.find((x) => x.textContent.trim() === ${JSON.stringify(text)})`}; if (!e) return false; e.click(); return true; })()`);
  const setSelect = (selector: string, value: string) =>
    js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);

  const summary: { screens: { name: string; findings: number; high: number }[]; flows: FlowResult[]; errors: string[] } = { screens: [], flows: [], errors: [] };

  // capturePage returns the last painted frame: wait until the DOM change has been painted (two animation frames).
  const painted = () => js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
  const capture = async (name: string) => {
    await sleep(300);
    await painted();
    const raw = await js<Omit<Snapshot, 'screen'> & { scrollHeight: number }>(COLLECT_SOURCE);
    const snap: Snapshot = { screen: name, viewport: raw.viewport, scrollWidth: raw.scrollWidth, boxes: raw.boxes, scrollers: raw.scrollers };
    const findings: Finding[] = auditGeometry(snap);
    writeFileSync(join(outDir, `${name}.png`), (await wc.capturePage()).toPNG());
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify({ ...snap, scrollHeight: raw.scrollHeight, findings }, null, 1));
    const suspects = [...new Set(findings.filter((f) => f.severity !== 'low').flatMap((f) => f.ids))];
    if (suspects.length) {
      await js(outlineSource(suspects));
      await painted();
      writeFileSync(join(outDir, `${name}__overlay.png`), (await wc.capturePage()).toPNG());
      await js(CLEAR_OUTLINE_SOURCE);
    }
    summary.screens.push({ name, findings: findings.length, high: findings.filter((f) => f.severity === 'high').length });
  };
  const flow = (name: string, ok: boolean, detail: string) => summary.flows.push({ flow: name, ok, detail });

  const qtyOfLastLine = () =>
    js<string>(`(() => { const rows = document.querySelectorAll('.cart tbody tr'); const r = rows[rows.length - 1]; if (!r) return ''; const i = r.querySelector('input[aria-label="line quantity"]'); return i ? i.value : r.cells[1].textContent.trim(); })()`);
  const lineCount = () => js<number>(`document.querySelectorAll('.cart tbody tr').length`);
  const clearBill = async () => {
    for (let i = 0; i < 20 && (await lineCount()) > 0; i++) {
      await click('button[aria-label="remove line"]');
      await sleep(120);
    }
  };
  const scan = async (code: string) => {
    await focus('input[aria-label="product search"]');
    await type(code);
    key('Enter');
    await sleep(500);
  };

  try {
    await waitFor(`document.querySelector('form input')`, 15000);
    win.setContentSize(1366, 768);
    await capture('00-login__light-en-1366x768');
    await focus('form input');
    await type(hooks.login.username);
    await focus('form input[type="password"]');
    await type(hooks.login.pin);
    key('Enter');
    if (!(await waitFor(`document.querySelector('.top nav')`, 8000))) throw new Error('login failed');

    const tabs = await js<string[]>(`[...document.querySelectorAll('.top nav button')].map((b) => b.textContent.trim())`);
    const variants = [
      { id: 'light-en-1366x768', theme: 'light', ar: false, w: 1366, h: 768 },
      { id: 'dark-en-1366x768', theme: 'dark', ar: false, w: 1366, h: 768 },
      { id: 'light-ar-1366x768', theme: 'light', ar: true, w: 1366, h: 768 },
      { id: 'light-en-1024x700', theme: 'light', ar: false, w: 1024, h: 700 },
    ];
    for (const [vi, v] of variants.entries()) {
      win.setContentSize(v.w, v.h);
      await setSelect('select[aria-label="appearance"]', v.theme);
      const isAr = await js<boolean>(`document.documentElement.dir === 'rtl'`);
      if (isAr !== v.ar) await click('button[aria-label="language"]');
      await sleep(300);
      for (const [i, tab] of tabs.entries()) {
        await js(`document.querySelectorAll('.top nav button')[${i}].click()`);
        await sleep(350);
        const slug = `${String(i + 1).padStart(2, '0')}-${tab.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-+|-+$/g, '')}`;
        if (tab === 'Sell') {
          if (await js<boolean>(`!document.querySelector('input[aria-label="product search"]')`)) {
            await click('button.primary'); // open shift with the default float (temporary data only)
            await waitFor(`document.querySelector('input[aria-label="product search"]')`);
          }
          await clearBill();
          await capture(`${slug}-empty__${v.id}`);
          if (vi === 0) await keyFlows();
          await clearBill();
          for (const code of ['6281000000000', '6281000000077', '6281000000033']) await scan(code); // fake seed barcodes
          await capture(`${slug}-lines__${v.id}`);
          await focus('input[aria-label="product search"]');
          key('Enter');
          await waitFor(`document.querySelector('[aria-label="payment step"].current')`, 1500);
          await capture(`${slug}-pay__${v.id}`);
          key('Escape');
          await sleep(200);
          await clearBill();
          continue;
        }
        if (tab === 'Customers') {
          await focus('input[aria-label="customer search"]');
          await type('a');
          await sleep(500);
          await js(`document.querySelector('table.list tbody tr')?.click()`);
          await sleep(400);
        }
        if (tab === 'Purchases') {
          await js(`document.querySelectorAll('[aria-label="purchases section"] button')[2]?.click()`);
          await sleep(300);
          await js(`document.querySelector('table.list tbody tr button')?.click()`);
          await sleep(400);
        }
        await capture(`${slug}__${v.id}`);
      }
    }
  } catch (e) {
    summary.errors.push(String(e));
  } finally {
    writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 1));
    app.quit();
  }

  async function keyFlows() {
    const box = 'input[aria-label="product search"]';
    // First-letter suggestions
    await focus(box);
    await type('W', 30);
    await sleep(600);
    const n = await js<number>(`document.querySelectorAll('.suggestions li, .suggestions [role="option"]').length`);
    flow('first-letter', n > 0, `${n} suggestions for "W"`);
    key('Escape');
    await js(`(() => { const e = document.querySelector(${JSON.stringify(box)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, ''); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(250);
    // + and - on the last unit line
    await scan('6281000000000');
    await focus(box);
    await sleep(400);
    key('+');
    await sleep(300);
    const afterPlus = await qtyOfLastLine();
    flow('plus', afterPlus === '2', `qty after + = ${afterPlus}`);
    key('-');
    await sleep(300);
    const afterMinus = await qtyOfLastLine();
    flow('minus', afterMinus === '1', `qty after - = ${afterMinus}`);
    // - on the last unit removes the line and offers Undo; Undo puts it back
    const linesBefore = await lineCount();
    key('-');
    await sleep(300);
    const removed = (await lineCount()) === linesBefore - 1;
    const undoShown = await js<boolean>(`!!document.querySelector('.undo-bar button')`);
    flow('minus-to-zero-undo-offered', removed && undoShown, `line removed: ${removed}, undo shown: ${undoShown}`);
    await capture('01-sell-undo__light-en-1366x768');
    await click('.undo-bar button');
    await sleep(300);
    const back = (await lineCount()) === linesBefore && (await qtyOfLastLine()) === '1';
    flow('undo-restores-line', back, `lines ${await lineCount()}, qty ${await qtyOfLastLine()}`);
    // Shift+Enter with text in the box is refused (no product picked, no payment step)
    await focus(box);
    await type('W', 30);
    await sleep(500);
    const linesNow = await lineCount();
    key('Enter', ['shift']);
    await sleep(400);
    const onPay = await js<boolean>(`!!document.querySelector('[aria-label="payment step"].current')`);
    const onQty = await js<boolean>(`!!document.querySelector('[aria-label="quantity step"]')`);
    const warn = await js<string>(`document.querySelector('.msg.warn')?.textContent ?? ''`);
    const linesAfter = await lineCount();
    const refused = !onPay && !onQty && linesAfter === linesNow && warn !== '';
    flow('shift-enter-with-text-refused', refused, `payment step: ${onPay}, qty step: ${onQty}, lines ${linesNow}->${linesAfter}, warning: "${warn}"`);
    if (onQty) key('Escape');
    key('Escape');
    await js(`(() => { const e = document.querySelector(${JSON.stringify(box)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, ''); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    // Shift+Enter: to payment, and never a sale
    await sleep(400);
    key('Enter', ['shift']);
    const toPay = await waitFor(`document.querySelector('[aria-label="payment step"].current')`, 1500);
    flow('shift-enter-to-pay', toPay, toPay ? 'payment step shown' : 'payment step not shown');
    if (toPay) {
      const before = hooks.salesCount();
      await focus('input[aria-label="cash received"]');
      await type('100');
      await sleep(400);
      key('Enter', ['shift']);
      key('Enter', ['shift']);
      await sleep(800);
      const after = hooks.salesCount();
      flow('shift-enter-on-pay-no-sale', after === before, `sales ${before} -> ${after}`);
      key('Escape');
      await sleep(300);
    } else flow('shift-enter-on-pay-no-sale', false, 'not reached');
    // Typing 0 on the first line removes it; the next line must keep its own quantity (no reused input showing "0")
    await clearBill();
    for (const code of ['6281000000000', '6281000000000', '6281000000077', '6281000000077']) await scan(code);
    await js(`(() => { const e = document.querySelector('.cart tbody tr input[aria-label="line quantity"]'); e.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, '0'); e.dispatchEvent(new Event('input', { bubbles: true })); e.blur(); })()`);
    await sleep(400);
    const left = await js<string[]>(`[...document.querySelectorAll('.cart tbody tr input[aria-label="line quantity"]')].map((i) => i.value)`);
    flow('type-zero-keeps-next-line', left.length === 1 && left[0] === '2', `quantities left: ${JSON.stringify(left)}`);
    await clearBill();
  }
}
