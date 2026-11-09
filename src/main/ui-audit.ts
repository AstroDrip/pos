/**
 * Development-only UI audit. Runs ONLY when POS_UI_AUDIT=<folder> is set and the app is not packaged (see main.ts).
 * Uses Electron's own APIs (executeJavaScript, sendInputEvent, capturePage); no browser-automation framework.
 * Writes screenshots, geometry findings and key-flow results into the folder, then quits the app.
 * Always run it against a temporary data folder with fake data (scripts/ui-audit.mjs does this).
 */
import { app, type BrowserWindow } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  // Audit scripts see only what is on screen: tabs that are open but hidden stay in the page. The app's own document is untouched.
  const VISIBLE_DOCUMENT = `window.__auditDocument ??= (() => {
    const shown = (list) => [...list].filter((e) => e.closest('[hidden]') === null);
    const wrap = (target) => new Proxy(target, {
      get(t, k) {
        if (k === 'querySelectorAll') return (s) => shown(t.querySelectorAll(s));
        if (k === 'querySelector') return (s) => shown(t.querySelectorAll(s))[0] ?? null;
        if (k === 'textContent' && t === window.document.body) return t.innerText;
        if (k === 'body') return wrap(t.body);
        const v = t[k];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    return wrap(window.document);
  })();`;
  const js = <T = unknown>(code: string): Promise<T> =>
    (wc.executeJavaScript(`{ ${VISIBLE_DOCUMENT} const document = window.__auditDocument; ${code} }`, true) as Promise<T>).catch((e: Error) => {
      throw new Error(`${e.message} in: ${code.slice(0, 160)}`);
    });
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
    const raw = (await wc.executeJavaScript(COLLECT_SOURCE, true).catch((e: Error) => {
      throw new Error(`${e.message} collecting ${name}`);
    })) as Omit<Snapshot, 'screen'> & { scrollHeight: number };
    const snap: Snapshot = { screen: name, viewport: raw.viewport, scrollWidth: raw.scrollWidth, boxes: raw.boxes, scrollers: raw.scrollers };
    const findings: Finding[] = auditGeometry(snap);
    writeFileSync(join(outDir, `${name}.png`), (await wc.capturePage()).toPNG());
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify({ ...snap, scrollHeight: raw.scrollHeight, findings }, null, 1));
    const suspects = [...new Set(findings.filter((f) => f.severity !== 'low').flatMap((f) => f.ids))];
    if (suspects.length) {
      await wc.executeJavaScript(outlineSource(suspects), true);
      await painted();
      writeFileSync(join(outDir, `${name}__overlay.png`), (await wc.capturePage()).toPNG());
      await wc.executeJavaScript(CLEAR_OUTLINE_SOURCE, true);
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
    if (process.env.POS_UI_AUDIT_DEMO === '1') {
      await demoTour(tabs);
      return;
    }
    const variants = [
      { id: 'light-en-1366x768', theme: 'light', ar: false, w: 1366, h: 768 },
      { id: 'dark-en-1366x768', theme: 'dark', ar: false, w: 1366, h: 768 },
      { id: 'light-ar-1366x768', theme: 'light', ar: true, w: 1366, h: 768 },
      { id: 'light-en-1024x700', theme: 'light', ar: false, w: 1024, h: 700 },
    ].filter((v) => !v.ar || process.env.POS_UI_AUDIT_ARABIC === '1'); // Arabic deferred by the owner (2026-11-08); set POS_UI_AUDIT_ARABIC=1 to include
    // The top bar must shrink back after its tabs wrapped (it used to keep the taller height)
    win.setContentSize(1024, 700);
    await sleep(400);
    const tall = await js<number>(`document.querySelector('.top').getBoundingClientRect().height`);
    win.setContentSize(1900, 900);
    await sleep(400);
    const wide = await js<number>(`document.querySelector('.top').getBoundingClientRect().height`);
    flow('top-bar-shrinks-back', tall > 60 && wide < 60, `height at 1024px: ${tall}, at 1900px: ${wide}`);
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
          if (vi === 0) {
            await keyFlows();
            await shortcutFlows();
            await rebindFlows();
            await billFlows();
            await sellStepFlows();
            await tabMemoryFlows();
            await productListFlows();
            await emptySearchFlows();
            await reloadFlows();
          }
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
          await js(`[...document.querySelectorAll('[aria-label="purchases section"] button')].find((b) => b.textContent.trim() === 'Balances and payments')?.click()`);
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

  /** Opens every tab of the demo shop and reports what each one shows. */
  async function demoTour(tabs: string[]) {
    const rows = () => js<number>(`document.querySelectorAll('table tbody tr:not(.empty), .kpi').length`);
    const empties = () => js<string[]>(`[...document.querySelectorAll('tr.empty')].map((e) => e.textContent.trim())`);
    const look = async (name: string) => {
      await sleep(1200);
      const n = await rows();
      await capture(`demo-${name}`);
      flow(`demo-${name}`, n > 0, `rows ${n}${(await empties()).map((e) => ` | empty: ${e}`).join('')}`);
    };
    for (const tab of tabs) {
      const name = tab.replace(/[^A-Za-z]/g, '').toLowerCase();
      await js(`[...document.querySelectorAll('.top nav button')].find((b) => b.textContent.trim() === ${JSON.stringify(tab)})?.click()`);
      await sleep(600);
      if (name === 'sell') {
        await sleep(600);
        const held = await js<boolean>(`document.body.textContent.includes('Lady in blue')`);
        const open = await js<boolean>(`!!document.querySelector('input[aria-label="product search"]')`);
        await capture('demo-sell');
        flow('demo-sell', held && open, `held bills shown ${held}, shift open ${open}`);
        continue;
      }
      if (name === 'help') continue;
      await look(name);
      const seg = name === 'purchases' ? '[aria-label="purchases section"] button' : '.page-header .seg button, .seg button';
      const count = await js<number>(`document.querySelectorAll(${JSON.stringify(seg)}).length`);
      for (let i = 0; i < count; i++) {
        const label = await js<string>(`document.querySelectorAll(${JSON.stringify(seg)})[${i}].textContent.trim()`);
        await js(`document.querySelectorAll(${JSON.stringify(seg)})[${i}].click()`);
        await sleep(300);
        await look(`${name}-${label.replace(/[^A-Za-z]/g, '').toLowerCase()}`);
      }
    }
  }

  /** Customers, Refund, Stock and Shift show their lists with nothing typed. */
  async function emptySearchFlows() {
    const tabTo = async (name: string) => {
      await js(`[...document.querySelectorAll('.top nav button')].find((b) => b.textContent.trim().endsWith(${JSON.stringify(name)}))?.click()`);
      await sleep(700);
    };
    const rows = (label: string) => js<number>(`document.querySelectorAll('table[aria-label="${label}"] tbody tr:not(.empty)').length`);
    await tabTo('Customers');
    await click('button', 'Close'); // tabs stay as they were left, so an earlier flow's account may still be open
    await sleep(200);
    await js(`(() => { const e = document.querySelector('input[aria-label="customer search"]'); if (e) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, ''); e.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
    await sleep(500);
    const people = await rows('customers list');
    await js(`document.querySelector('table[aria-label="customers list"] tbody tr')?.click()`);
    await sleep(500);
    const hidden = (await rows('customers list')) === 0;
    flow('customers-listed-without-search', people >= 2 && hidden, `rows ${people}, list hidden while an account is open ${hidden}`);
    await tabTo('Refund');
    const sold = await rows('recent sales');
    const first = await js<string>(`document.querySelector('table[aria-label="recent sales"] tbody td')?.textContent ?? ''`);
    await js(`document.querySelector('table[aria-label="recent sales"] tbody tr')?.click()`);
    await sleep(600);
    const opened = await js<string>(`document.querySelector('.card.section h3')?.textContent ?? ''`);
    flow('refund-recent-sales-listed-and-open', sold > 0 && first !== '' && opened === first, `rows ${sold}, first ${first}, opened ${opened}`);
    await tabTo('Stock');
    const stock = await js<number>(`[...document.querySelectorAll('h3')].find((h) => h.textContent.trim() === 'Stock on hand')?.parentElement.querySelectorAll('tbody tr:not(.empty)').length ?? 0`);
    flow('stock-listed-without-tick', stock >= 8, `rows ${stock}`);
    await tabTo('Shift');
    const shifts = await rows('past shifts');
    flow('past-shifts-listed', shifts >= 1, `rows ${shifts}`);
    await js(`document.querySelectorAll('.top nav button')[0].click()`);
    await sleep(400);
  }

  /** Products lists everything with no search, and a turned-off item can be found and turned back on. */
  async function productListFlows() {
    const setVal = (sel: string, v: string) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('missing ' + ${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, ${JSON.stringify(v)}); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const rows = () => js<number>(`document.querySelectorAll('table[aria-label="products list"] tbody tr').length`);
    await js(`[...document.querySelectorAll('.top nav button')].find((b) => b.textContent.trim().endsWith('Products'))?.click()`);
    await sleep(600);
    const all = await rows();
    flow('products-listed-without-search', all > 0, `rows ${all}`);
    await js(`document.querySelector('table[aria-label="products list"] tbody tr')?.click()`);
    await waitFor(`document.querySelector('input[aria-label="status reason"]')`);
    await setVal('input[aria-label="status reason"]', 'Audit test');
    await click('button', 'Deactivate product');
    await sleep(500);
    const fewer = await rows();
    await setSelect('select[aria-label="product status"]', 'inactive');
    await sleep(500);
    const off = await rows();
    await js(`document.querySelector('table[aria-label="products list"] tbody tr')?.click()`);
    await waitFor(`document.querySelector('input[aria-label="status reason"]')`);
    await setVal('input[aria-label="status reason"]', 'Audit test');
    await click('button', 'Turn product back on');
    await sleep(500);
    const offAfter = await rows();
    await setSelect('select[aria-label="product status"]', 'active');
    await sleep(500);
    const back = await rows();
    flow('product-off-found-and-back-on', fewer === all - 1 && off === 1 && offAfter === 0 && back === all, `all ${all}, after off ${fewer}, inactive ${off}, inactive after on ${offAfter}, active ${back}`);
    await js(`document.querySelectorAll('.top nav button')[0].click()`);
    await sleep(400);
  }

  /** The real bill screen and a real printed receipt, with made-up details. */
  async function billFlows() {
    const setVal = (sel: string, v: string) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('missing ' + ${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, ${JSON.stringify(v)}); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const tabTo = async (name: string) => {
      await js(`[...document.querySelectorAll('.top nav button')].find((b) => b.textContent.trim().endsWith(${JSON.stringify(name)}))?.click()`);
      await sleep(400);
    };
    const section = async (name: string) => {
      await js(`[...document.querySelectorAll('[aria-label="purchases section"] button')].find((b) => b.textContent.trim() === ${JSON.stringify(name)})?.click()`);
      await sleep(350);
    };
    const saveOff = () => js<boolean>(`document.querySelector('button[aria-label="save bill"]').disabled`);
    const add = async (code: string) => {
      await setVal('input[aria-label="bill product search"]', code);
      await sleep(350);
      await focus('input[aria-label="bill product search"]');
      key('Enter');
      await sleep(500);
    };

    await tabTo('Purchases');
    await section('Enter supplier bill');
    await capture('63-enter-bill-empty__light-en-1366x768');
    const sup = await js<string>(`[...document.querySelector('select[aria-label="bill supplier"]').options].find((o) => o.textContent.includes('Al Marai')).value`);
    await setSelect('select[aria-label="bill supplier"]', sup);
    await sleep(300);
    await setVal('input[aria-label="paper number"]', 'AUDIT-JUICE-1');
    await click('button[aria-label="mark credit"]');
    await add('6281000000000');
    await add('6281000000077');
    const lines = await js<number>(`document.querySelectorAll('.bill-line').length`);
    await setVal('input[aria-label="pieces in pack 1"]', '24');
    await setVal('input[aria-label="packs 1"]', '2');
    await setVal('input[aria-label="price 1"]', '111.36');
    await setVal('input[aria-label="pieces in pack 2"]', '24');
    await setVal('input[aria-label="packs 2"]', '1');
    await setVal('input[aria-label="price 2"]', '118.29');
    await sleep(200);
    await setVal('input[aria-label="paper net"]', '341.04');
    await setVal('input[aria-label="paper vat"]', '51.15');
    await setVal('input[aria-label="paper total"]', '392.19');
    await sleep(200);
    const offWhenWrong = await saveOff();
    await setVal('input[aria-label="paper net"]', '341.01');
    await setVal('input[aria-label="paper total"]', '392.16');
    await sleep(200);
    await js(`document.querySelector('input[aria-label="costs checked"]')?.click()`);
    await sleep(200);
    const onWhenRight = !(await saveOff());
    flow('bill-save-off-until-match', lines === 2 && offWhenWrong && onWhenRight, `lines ${lines}, off when wrong ${offWhenWrong}, on when right ${onWhenRight}`);
    await capture('64-enter-bill-lines__light-en-1366x768');
    await click('button[aria-label="save bill"]');
    await sleep(700);
    const saved = await js<string>(`document.querySelector('.bill .msg.ok')?.textContent ?? ''`);
    await section('Enter supplier bill');
    await setVal('input[aria-label="paper number"]', 'ABANDONED-1');
    await sleep(200);
    await js('window.confirm = () => true; 0');
    await click('button[aria-label="start over"]');
    await sleep(200);
    const cleared = await js<boolean>(`localStorage.getItem('pos.billDraft') === null && document.querySelector('input[aria-label="paper number"]').value === ''`);
    flow('bill-start-over-clears-draft', cleared, `cleared ${cleared}`);
    await section('Saved bills');
    await sleep(400);
    const row = await js<string>(`[...document.querySelectorAll('table[aria-label="saved bills"] tr')].find((r) => r.textContent.includes('AUDIT-JUICE-1'))?.textContent ?? ''`);
    flow('bill-juice-ends-exact', saved.startsWith('Saved') && row.includes('341.01') && row.includes('51.15') && row.includes('392.16'), `"${saved}", row "${row}"`);
    await click('button[aria-label="open bill AUDIT-JUICE-1"]');
    await sleep(400);
    await capture('65-saved-bill__light-en-1366x768');
    await section('Purchase reports');
    await capture('66-purchase-reports__light-en-1366x768');

    // Store details reach a printed receipt (made-up details, temporary data)
    await tabTo('Admin');
    await setVal('input[aria-label="store nameEn"]', 'Fictional Mart');
    await setVal('input[aria-label="store addressLine"]', 'Made Up District');
    await setVal('input[aria-label="store vatNumber"]', '300000000000003');
    await setVal('input[aria-label="store mobile"]', '0500000000');
    await click('button', 'Save store details');
    await sleep(400);
    await tabTo('Sell');
    await sleep(300);
    await clearBill();
    await scan('6281000000000');
    await focus('input[aria-label="product search"]');
    await sleep(500);
    key('Enter', ['shift']);
    await waitFor(`document.querySelector('[aria-label="payment step"].current')`, 1500);
    await sleep(500);
    await focus('input[aria-label="cash received"]');
    await sleep(500);
    key('Enter');
    await sleep(1200);
    const file = process.env.POS_RECEIPT_TO_FILE ?? '';
    const html = file && existsSync(file) ? readFileSync(file, 'utf8') : '';
    flow('store-details-on-receipt', ['Fictional Mart', 'Made Up District', '300000000000003', '0500000000', 'Simplified Tax Invoice', 'TEST BUILD', 'VAT Included'].every((x) => html.includes(x)), `receipt length ${html.length}`);
  }

  /** Admin changes keys through the real screen; the till follows at once; everything is put back. */
  async function rebindFlows() {
    const box = 'input[aria-label="product search"]';
    const isOpen = () => js<boolean>(`!!document.querySelector('.palette')`);
    const tabTo = async (name: string) => {
      await js(`[...document.querySelectorAll('.top nav button')].find((b) => b.textContent.trim().endsWith(${JSON.stringify(name)}))?.click()`);
      await sleep(400);
    };
    const shownKey = (id: string) => js<string>(`document.querySelector('[aria-label="key ${id}"]')?.textContent ?? ''`);
    const press = async (id: string, k: string, mods: ('shift' | 'control')[] = []) => {
      await click(`button[aria-label="change ${id}"]`);
      await sleep(150);
      key(k, mods);
      await sleep(200);
    };
    const save = async () => {
      await click('button.primary', 'Save shortcuts');
      await sleep(400);
    };
    const note = () => js<string>(`document.querySelector('[aria-label="keyboard shortcuts"] .msg')?.textContent ?? ''`);

    await tabTo('Admin');
    // F1 while recording is recorded, it does not open Help
    await press('qty.focus', 'F1');
    const noHelp = await js<boolean>(`!document.querySelector('.help-overlay')`);
    flow('recording-a-key-opens-nothing', noHelp && (await note()) !== '', `no help ${noHelp}, message "${await note()}"`);
    // Refused keys
    await press('palette.open', 'c', ['control']);
    flow('reserved-key-refused', (await shownKey('palette.open')) === 'Ctrl+K' && (await note()) !== '', `key ${await shownKey('palette.open')}, "${await note()}"`);
    await capture('62-keyboard-settings__light-en-1366x768');
    await press('palette.open', 'F6');
    await press('pay.cash', 'F9');
    await press('letter.H', 'b');
    await save();
    flow('admin-saves-new-keys', (await note()) === 'Keyboard shortcuts saved.' && (await shownKey('letter.H')) === 'B', `"${await note()}"`);

    await tabTo('Sell');
    await sleep(300);
    await clearBill();
    await focus(box);
    key('k', ['control']);
    await sleep(200);
    const oldOff = !(await isOpen());
    key('F6');
    await sleep(200);
    const newOn = await isOpen();
    const letter = await js<string>(`[...document.querySelectorAll('.palette li .kbd')].map((e) => e.textContent).join(' ')`);
    key('Escape');
    await sleep(200);
    flow('changed-palette-key', oldOff && newOn && letter.includes('B') && !letter.includes('H'), `old off ${oldOff}, new on ${newOn}, letters ${letter}`);

    await scan('6281000000000');
    await focus(box);
    await sleep(500);
    key('Enter', ['shift']);
    await waitFor(`document.querySelector('[aria-label="payment step"].current')`, 1500);
    await sleep(500);
    await focus('input[aria-label="cash received"]');
    await sleep(500);
    const label = await js<string>(`document.querySelector('[aria-label="payment step"] button.primary .kbd')?.textContent ?? ''`);
    const before = hooks.salesCount();
    key('Enter');
    await sleep(500);
    const enterOff = hooks.salesCount() === before;
    key('F9');
    key('F9');
    await sleep(1200);
    flow('changed-cash-key-pays-once', label === 'F9' && enterOff && hooks.salesCount() === before + 1, `label ${label}, enter off ${enterOff}, sales ${before} -> ${hooks.salesCount()}`);

    await tabTo('Admin');
    await click('button', 'Reset all to default');
    await sleep(400);
    await tabTo('Sell');
    await sleep(300);
    await focus(box);
    key('k', ['control']);
    await sleep(200);
    flow('reset-all-restores-defaults', await isOpen(), `open ${await isOpen()}`);
    key('Escape');
    await sleep(200);
  }

  /** Real key presses for F1, F4, Ctrl+F and Quick Actions (Ctrl+K). */
  async function shortcutFlows() {
    const box = 'input[aria-label="product search"]';
    const isOpen = () => js<boolean>(`!!document.querySelector('.palette')`);
    const active = () => js<string>(`document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id ?? ''`);
    const rows = () => js<string[]>(`[...document.querySelectorAll('.palette li .kbd')].map((e) => e.textContent)`);
    const value = (sel: string) => js<string>(`document.querySelector(${JSON.stringify(sel)})?.value ?? ''`);
    const clearBox = () => js(`(() => { const e = document.querySelector(${JSON.stringify(box)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, ''); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const ctrlK = async () => { key('k', ['control']); await sleep(200); };
    const letter = async (l: string) => { key(l); await sleep(250); };
    const esc = async () => { key('Escape'); await sleep(200); };
    const tabTo = async (name: string) => {
      await js(`[...document.querySelectorAll('.top nav button')].find((b) => b.textContent.trim().endsWith(${JSON.stringify(name)}))?.click()`);
      await sleep(400);
    };

    await clearBill();
    await focus(box);
    // Letters outside the palette are plain typing
    await type('phscrim', 40);
    await sleep(200);
    flow('letters-are-typing-outside-palette', !(await isOpen()) && (await value(box)) === 'phscrim', `box: "${await value(box)}"`);
    await esc();
    await clearBox();
    await sleep(250);

    // Open, show letters, close, focus comes back
    await focus(box);
    await ctrlK();
    const shown = await rows();
    flow('ctrl-k-opens-on-sell', (await isOpen()) && ['P', 'C', 'S', 'H', 'R', 'I', 'M'].every((x) => shown.includes(x)), `letters: ${shown.join(' ')}`);
    await capture('60-quick-actions__light-en-1366x768');
    await esc();
    flow('esc-closes-and-restores-focus', !(await isOpen()) && (await active()) === 'product search', `focus: ${await active()}`);

    // Ctrl+K twice, and a held key, never stack two boxes
    await ctrlK();
    await ctrlK();
    flow('ctrl-k-again-closes', !(await isOpen()), `open: ${await isOpen()}`);

    // Arabic layout (physical K key)
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ن', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true }))`);
    await sleep(200);
    flow('ctrl-k-arabic-layout', await isOpen(), `open: ${await isOpen()}`);
    await esc();

    // Disabled action: refused with the reason, stays open
    await ctrlK();
    await letter('h');
    const note = await js<string>(`document.querySelector('.palette .msg')?.textContent ?? ''`);
    flow('unavailable-action-refused', (await isOpen()) && note !== '' && (await lineCount()) === 0, `note: "${note}"`);
    await esc();

    // Searching by name: letters are typing
    await ctrlK();
    key('Tab');
    await sleep(100);
    await type('hold', 60);
    await sleep(200);
    const filtered = await rows();
    flow('palette-search-by-name', (await isOpen()) && filtered.length === 1 && filtered[0] === 'H', `rows: ${filtered.join(' ')}`);
    await esc();

    // Arrow keys and Enter
    await ctrlK();
    key('Down');
    await sleep(100);
    const hi = await js<string>(`document.querySelector('.palette li.active .kbd')?.textContent ?? ''`);
    key('Enter');
    await sleep(250);
    flow('palette-arrows-and-enter', hi === 'C' && !(await isOpen()) && (await active()) === 'customer-phone', `highlight ${hi}, focus ${await active()}`);

    // P goes to product search
    await ctrlK();
    await letter('p');
    flow('quick-p-product-search', !(await isOpen()) && (await active()) === 'product search', `focus ${await active()}`);

    // Scanner works while the palette is open, and its digits are not commands
    await ctrlK();
    await type('6281000000000');
    key('Enter');
    await sleep(600);
    const afterScan = await lineCount();
    const leftInPalette = await value('input[aria-label="quick actions search"]');
    flow('scanner-with-palette-open', afterScan === 1 && (await isOpen()) && leftInPalette === '', `lines ${afterScan}, box "${leftInPalette}"`);
    await esc();

    // Item information: a scan checks the item and does NOT add it to the bill
    await ctrlK();
    await letter('i');
    await type('6281000000077');
    key('Enter');
    await sleep(600);
    const info = await js<boolean>(`!!document.querySelector('.palette-item')`);
    await capture('61-item-information__light-en-1366x768');
    flow('quick-i-scan-does-not-add', info && (await lineCount()) === 1, `info shown ${info}, lines ${await lineCount()}`);
    await esc();

    // M with a bill on screen opens Customers. The bill stays on Sell.
    await ctrlK();
    await letter('m');
    await sleep(600);
    const wentToCustomers = await js<boolean>(`document.querySelector('.top nav button.active')?.textContent.trim().endsWith('Customers')`);
    await js(`[...document.querySelectorAll('.top nav button')].find((b) => b.textContent.trim().endsWith('Sell'))?.click()`);
    await sleep(500);
    flow('quick-m-with-bill-keeps-bill', wentToCustomers && (await lineCount()) === 1, `on customers ${wentToCustomers}, lines ${await lineCount()}`);

    // F4, + and − on the line, Enter back to search
    await focus(box);
    key('F4');
    await sleep(200);
    const f4 = await active();
    key('+');
    await sleep(300);
    const plus = await qtyOfLastLine();
    const kept = await active();
    key('-');
    await sleep(300);
    const minus = await qtyOfLastLine();
    key('Enter');
    await sleep(300);
    flow('f4-plus-minus-enter', f4 === 'line quantity' && plus === '2' && kept === 'line quantity' && minus === '1' && (await active()) === 'product search', `f4 ${f4}, + ${plus}, focus ${kept}, - ${minus}, then ${await active()}`);

    // F1 over the bill; Esc returns to the same box with the bill kept
    await focus(box);
    key('F1');
    await sleep(400);
    const help = await js<boolean>(`!!document.querySelector('.help-overlay .help-article')`);
    await ctrlK();
    const noStack = !(await isOpen());
    await esc();
    await sleep(200);
    flow('f1-keeps-bill-no-popup-on-popup', help && noStack && (await lineCount()) === 1 && (await active()) === 'product search', `help ${help}, palette blocked ${noStack}, focus ${await active()}`);

    // H then R
    await ctrlK();
    await letter('h');
    await sleep(300);
    const heldEmpty = await lineCount();
    await ctrlK();
    await letter('r');
    await sleep(200);
    key('Enter');
    await sleep(500);
    flow('quick-h-then-r', heldEmpty === 0 && (await lineCount()) === 1 && !(await isOpen()), `after hold ${heldEmpty}, after retrieve ${await lineCount()}`);

    // Quantity step: search suggestion, then Enter confirms; Ctrl+K and F1 cannot lose the chosen item
    await focus(box);
    await type('W', 30);
    await sleep(600);
    key('Enter');
    await sleep(300);
    const qtyOpen = await js<boolean>(`!!document.querySelector('[aria-label="quantity step"]')`);
    await ctrlK();
    key('F1');
    await sleep(200);
    const stillQty = await js<boolean>(`!!document.querySelector('[aria-label="quantity step"]') && !document.querySelector('.help-overlay') && !document.querySelector('.palette')`);
    flow('qty-step-protected', qtyOpen && stillQty, `qty step ${qtyOpen}, kept ${stillQty}`);
    await esc();
    await sleep(200);

    // Payment step: Ctrl+F refused; Shift+Enter never pays; Enter pays once
    await focus(box);
    await sleep(400);
    key('Enter', ['shift']);
    await waitFor(`document.querySelector('[aria-label="payment step"].current')`, 1500);
    await sleep(500);
    key('f', ['control']);
    await sleep(200);
    const stayed = await active();
    await ctrlK();
    await letter('h');
    const holdRefused = (await isOpen()) && (await lineCount()) >= 1;
    await esc();
    flow('pay-step-protected', stayed === 'cash received' && holdRefused, `focus ${stayed}, hold refused ${holdRefused}`);
    const before = hooks.salesCount();
    await focus('input[aria-label="cash received"]');
    await sleep(400);
    key('Enter');
    key('Enter');
    key('Enter');
    await sleep(1200);
    flow('enter-pays-cash-once', hooks.salesCount() === before + 1 && (await lineCount()) === 0, `sales ${before} -> ${hooks.salesCount()}`);

    // Card: Ctrl+Enter, once; empty bill can never be paid
    await sleep(600);
    await scan('6281000000000');
    await focus(box);
    await sleep(500);
    key('Enter', ['shift']);
    await waitFor(`document.querySelector('[aria-label="payment step"].current')`, 1500);
    await sleep(500);
    const b2 = hooks.salesCount();
    key('Enter', ['control']);
    key('Enter', ['control']);
    await sleep(1200);
    flow('ctrl-enter-pays-card-once', hooks.salesCount() === b2 + 1, `sales ${b2} -> ${hooks.salesCount()}`);
    const b3 = hooks.salesCount();
    await focus(box);
    await sleep(500);
    key('Enter', ['shift']);
    key('Enter');
    key('Enter', ['control']);
    await sleep(600);
    flow('empty-bill-never-paid', hooks.salesCount() === b3, `sales ${b3} -> ${hooks.salesCount()}`);

    // Review findings
    await clearBill();
    await focus(box);
    await ctrlK();
    await type('6281000000000');
    key('Enter');
    await sleep(600);
    await letter('m');
    await sleep(300);
    // M is allowed with a bill now that tabs stay open: the item scanned meanwhile is still on the bill afterwards.
    await js(`[...document.querySelectorAll('.top nav button')].find((b) => b.textContent.trim().endsWith('Sell'))?.click()`);
    await sleep(500);
    flow('palette-scan-keeps-bill-after-m', (await lineCount()) === 1, `lines ${await lineCount()}`);
    await esc();

    await focus(box);
    await sleep(300);
    key('+');
    await sleep(200);
    key('+');
    await sleep(200);
    key('+');
    await sleep(200);
    key('+');
    await sleep(300);
    const lq = 'input[aria-label="line quantity"]';
    key('F4');
    await sleep(200);
    await type('4', 30);
    await sleep(100);
    key('+');
    await sleep(300);
    const boxShows = await value(lq);
    await type('3', 30);
    await sleep(100);
    key('Enter');
    await sleep(300);
    const afterType = await qtyOfLastLine();
    flow('line-qty-box-matches-bill', boxShows === '5' && afterType === '3', `box after + "${boxShows}", after typing 3: ${afterType}`);

    await focus(box);
    await sleep(500);
    key('Enter', ['shift']);
    await waitFor(`document.querySelector('[aria-label="payment step"].current')`, 1500);
    await sleep(500);
    await focus('input[aria-label="cash received"]');
    await sleep(500);
    await ctrlK();
    await letter('i');
    await type('6281000000077');
    key('Enter');
    await sleep(600);
    const b5 = hooks.salesCount();
    key('Enter');
    key('Enter');
    await sleep(900);
    flow('double-enter-closing-palette-never-pays', hooks.salesCount() === b5 && (await lineCount()) === 1, `sales ${b5} -> ${hooks.salesCount()}`);
    await focus('input[aria-label="cash received"]');
    await esc();
    await sleep(300);
    await clearBill();

    await focus(box);
    await type('W', 30);
    await sleep(600);
    key('Enter');
    await sleep(300);
    await js('document.activeElement?.blur()');
    await sleep(400);
    await ctrlK();
    flow('click-away-from-qty-step-frees-keys', await isOpen(), `palette open ${await isOpen()}`);
    await esc();

    // Window loses and regains focus while the palette is open
    await focus(box);
    await ctrlK();
    win.blur();
    await sleep(200);
    win.focus();
    wc.focus();
    await sleep(200);
    const stillOpen = await isOpen();
    await esc();
    flow('window-focus-change', stillOpen && !(await isOpen()), `open after refocus ${stillOpen}`);

    // Other screens: right letters, right target
    const allLetters = ['P', 'C', 'S', 'H', 'R', 'I', 'M'];
    const expected: Record<string, string[]> = { Customers: allLetters, Stock: allLetters, Products: allLetters, Purchases: allLetters, Accounting: allLetters };
    for (const [name, letters] of Object.entries(expected)) {
      await tabTo(name);
      await js('document.activeElement?.blur()');
      await ctrlK();
      const got = await rows();
      const empty = await js<boolean>(`!!document.querySelector('.palette .none')`);
      flow(`ctrl-k-on-${name.toLowerCase()}`, got.slice().sort().join() === letters.slice().sort().join() && !empty, `letters: ${got.join(' ')}`);
      await esc();
    }

    await tabTo('Stock');
    await ctrlK();
    await letter('i');
    await type('6281000000077');
    key('Enter');
    await sleep(700);
    const stockInfo = await js<boolean>(`!!document.querySelector('.palette-item')`);
    flow('quick-i-scan-off-sell', stockInfo, `info shown ${stockInfo}`);
    await esc();

    await tabTo('Purchases');
    await js('document.activeElement?.blur()');
    await ctrlK();
    await letter('p');
    await sleep(500);
    flow('quick-p-on-purchases', (await active()) === 'return product search', `focus ${await active()}`);

    await tabTo('Stock');
    await js('document.activeElement?.blur()');
    key('f', ['control']);
    await sleep(200);
    flow('ctrl-f-on-stock', (await js<string>(`document.activeElement?.getAttribute('data-kb-search') ?? ''`)) === 'product', `focus ${await active()}`);
    await type('zz', 60);
    await sleep(100);
    key('Escape');
    await sleep(150);
    flow('esc-clears-suggestions', (await value('[data-kb-search="product"]')) === '', `box "${await value('[data-kb-search="product"]')}"`);

    await tabTo('Customers');
    const fields = 'input:not([data-kb-search]):not([type=checkbox]):not([disabled])';
    await focus(fields);
    await type('abc', 60);
    const typed = await js<string>(`document.activeElement?.value ?? ''`);
    key('f', ['control']);
    await sleep(200);
    const inField = await js<string>(`document.activeElement?.value ?? ''`);
    flow('ctrl-f-does-not-steal-form-editing', typed === 'abc' && inField === 'abc', `typed "${typed}", focus value "${inField}"`);

    await tabTo('Purchases');
    await js('document.activeElement?.blur()');
    const b4 = hooks.salesCount();
    await ctrlK();
    await letter('m');
    await sleep(500);
    const settle = await js<boolean>(`document.activeElement === document.querySelector('[data-kb-settle] select')`);
    flow('quick-m-opens-settlement-only', settle && hooks.salesCount() === b4 && !(await isOpen()), `supplier box focused ${settle}`);
    await ctrlK();
    await letter('s');
    const supplierList = await js<number>(`document.querySelectorAll('.palette li').length`);
    await esc();
    flow('quick-s-supplier-search', supplierList > 0, `suppliers listed ${supplierList}`);

    // Letters from another screen open that screen
    const onTab = (name: string) => js<boolean>(`document.querySelector('.top nav button.active')?.textContent.trim().endsWith(${JSON.stringify(name)})`);
    await tabTo('Accounting');
    await ctrlK();
    await letter('p');
    await sleep(900);
    flow('quick-p-from-accounting-opens-sell', (await onTab('Sell')) && (await active()) === 'product search' && !(await isOpen()), `focus ${await active()}`);

    await tabTo('Reports');
    await ctrlK();
    await letter('c');
    await sleep(700);
    flow('quick-c-from-reports-opens-customers', (await onTab('Customers')) && (await active()) === 'customer search', `focus ${await active()}`);

    await tabTo('Stock');
    await ctrlK();
    const holdGrey = await js<boolean>(`[...document.querySelectorAll('.palette li')].some((l) => l.querySelector('.kbd')?.textContent === 'H' && l.getAttribute('aria-disabled') === 'true')`);
    await letter('h');
    await sleep(200);
    flow('quick-h-grey-off-sell', holdGrey && (await onTab('Stock')) && (await isOpen()), `grey ${holdGrey}`);
    await esc();

    await tabTo('Accounting');
    await ctrlK();
    await letter('s');
    await sleep(400);
    const listed = await js<number>(`document.querySelectorAll('.palette li').length`);
    const stayedPut = await onTab('Accounting');
    key('Enter');
    await sleep(900);
    const chosen = await js<boolean>(`!!document.querySelector('[data-kb-settle]')`);
    flow('quick-s-from-accounting-picks-then-opens', listed > 0 && stayedPut && (await onTab('Purchases')) && chosen, `suppliers ${listed}, stayedPut ${stayedPut}, settle ${chosen}`);

    // A bill on Sell: Supplier search must not leave it
    await tabTo('Sell');
    await sleep(300);
    await focus(box);
    await type('6281000000000');
    key('Enter');
    await sleep(700);
    const sLines = await lineCount();
    await focus(box);
    await ctrlK();
    await letter('s');
    await sleep(300);
    const sNote = await js<string>(`document.querySelector('.palette .msg')?.textContent ?? ''`);
    await esc();
    flow('quick-s-with-a-bill-stays-on-sell', sLines >= 1 && (await lineCount()) === sLines && (await onTab('Sell')), `lines ${sLines}, note "${sNote}"`);

    // A held order brought back from another screen
    await focus(box);
    await ctrlK();
    await letter('h');
    await sleep(700);
    const clearedByHold = (await lineCount()) === 0;
    await tabTo('Stock');
    await ctrlK();
    await letter('r');
    await sleep(400);
    const heldListed = await js<number>(`document.querySelectorAll('.palette li').length`);
    key('Enter');
    await sleep(1000);
    flow('quick-r-from-stock-brings-bill-back', clearedByHold && heldListed >= 1 && (await onTab('Sell')) && (await lineCount()) === sLines, `held ${heldListed}, lines ${await lineCount()}`);
    await clearBill();

    // Sell with an empty bill: M goes to the collection screen, and takes no payment
    await tabTo('Sell');
    await sleep(300);
    await focus(box);
    await ctrlK();
    await letter('m');
    await sleep(500);
    const onCustomers = await js<boolean>(`document.querySelector('.top nav button.active')?.textContent.trim().endsWith('Customers')`);
    flow('quick-m-from-sell-opens-collection', onCustomers && (await active()) === 'customer search', `on customers ${onCustomers}, focus ${await active()}`);
    await tabTo('Sell');
    await sleep(300);
    await tabTo('Sell');
    await sleep(300);
  }

  /** What survives the screen being wiped, as after a restart. */
  async function reloadFlows() {
    const box = 'input[aria-label="product search"]';
    const openNamed = async (name: string) => {
      await js(`[...document.querySelectorAll('.top nav button')].find((b) => b.textContent.trim().endsWith(${JSON.stringify(name)}))?.click()`);
      await sleep(600);
    };
    const reload = async () => {
      wc.reload();
      await sleep(800);
      await waitFor(`document.querySelector('.top nav')`, 8000);
      await sleep(800);
    };
    const active = () => js<string>(`document.querySelector('.top nav button.active')?.textContent.trim() ?? ''`);
    const userPrefix = () => js<string>(`(/^pos\\.ui\\.\\d+\\./.exec(Object.keys(localStorage).find((k) => k.startsWith('pos.ui.')) ?? '') ?? [''])[0]`);

    await openNamed('Sell');
    await clearBill();
    await focus(box);
    await scan('6281000000000');
    await sleep(900);
    await reload();
    const banner = await waitFor(`document.querySelector('[aria-label="bill left open"]')`, 3000);
    await click('[aria-label="bill left open"] button', 'Restore');
    await sleep(400);
    flow('reload-restores-bill', banner && (await lineCount()) === 1, `offered ${banner}, lines ${await lineCount()}`);
    await clearBill();
    await sleep(700);

    await openNamed('Reports');
    const setDate = (value: string) => js(`(() => { const e = document.querySelector('input[type="date"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const dateIs = () => js<string>(`document.querySelector('input[type="date"]')?.value ?? ''`);
    await setDate('2026-01-02');
    await sleep(300);
    await openNamed('Stock');
    await openNamed('Reports');
    flow('filters-survive-tab-switch', (await dateIs()) === '2026-01-02', `from ${await dateIs()}`);
    await reload();
    flow('reload-restores-filters-and-tab', (await active()).endsWith('Reports') && (await dateIs()) === '2026-01-02', `tab ${await active()}, from ${await dateIs()}`);

    await openNamed('Help');
    await js(`document.querySelectorAll('.help-nav li button')[4]?.click()`);
    await sleep(300);
    const title = () => js<string>(`document.querySelector('.help-article h3')?.textContent ?? ''`);
    const picked = await title();
    await js('window.scrollTo(0, 120)');
    await sleep(400);
    const y = await js<number>('window.scrollY');
    await openNamed('Stock');
    await openNamed('Help');
    await sleep(300);
    const sameY = await js<number>('window.scrollY');
    flow('help-reopens-same-article-and-scroll', picked !== '' && (await title()) === picked && Math.abs(sameY - y) <= 2, `article ${picked}, scroll ${y} -> ${sameY}`);

    const prefix = await userPrefix();
    await openNamed('Customers');
    await js(`localStorage.setItem(${JSON.stringify(prefix + 'customers.openId')}, '999999')`);
    await reload();
    await waitFor(`document.querySelector('table[aria-label="customers list"] tbody tr')`, 3000);
    const rows = await js<number>(`document.querySelectorAll('table[aria-label="customers list"] tbody tr').length`);
    flow('restored-missing-customer-starts-clean', rows >= 1, `rows ${rows}`);

    await js(`localStorage.setItem(${JSON.stringify(prefix + 'app.tab')}, '"nonexistent"')`);
    await reload();
    flow('last-tab-not-allowed-falls-back-to-sell', (await active()).endsWith('Sell'), `tab ${await active()}`);

    await focus(box);
    await scan('6281000000000');
    await sleep(900);
    await click('.utils button', 'Log out');
    await waitFor(`document.querySelector('form input')`, 4000);
    await focus('form input');
    await type(hooks.login.username);
    await focus('form input[type="password"]');
    await type(hooks.login.pin);
    key('Enter');
    await waitFor(`document.querySelector('.top nav')`, 8000);
    await sleep(800);
    const offered = await waitFor(`document.querySelector('[aria-label="bill left open"]')`, 3000);
    flow('logout-clears-screen', offered && (await lineCount()) === 0, `offered ${offered}, lines ${await lineCount()}`);
    await click('[aria-label="bill left open"] button', 'Discard');
    await sleep(500);
    await focus(box);
  }

  /** Open tabs stay as they were left, and a hidden tab cannot react to anything. */
  async function tabMemoryFlows() {
    const box = 'input[aria-label="product search"]';
    const code = '6281000000000';
    const openNamed = async (name: string) => {
      await js(`[...document.querySelectorAll('.top nav button')].find((b) => b.textContent.trim().endsWith(${JSON.stringify(name)}))?.click()`);
      await sleep(600);
    };
    await clearBill();
    await focus(box);
    await scan(code);
    await sleep(300);
    await openNamed('Stock');
    const waiting = await js<boolean>(`!!window.document.querySelector('[data-tab="sell"][hidden]')`);
    await scan(code);
    await sleep(400);
    await openNamed('Sell');
    flow('hidden-sell-ignores-scan', waiting && (await lineCount()) === 1, `sell kept hidden ${waiting}, lines ${await lineCount()}`);
    flow('bill-survives-tab-switch', (await lineCount()) === 1, `lines ${await lineCount()}`);

    // A popup left open in a hidden tab must not block the keys of the tab on screen.
    await openNamed('Stock');
    await js(`(() => { const d = window.document.createElement('div'); d.id = 'audit-fake-popup'; d.setAttribute('aria-modal', 'true'); window.document.querySelector('[data-tab="sell"]').appendChild(d); })()`);
    key('k', ['control']);
    await sleep(300);
    const opened = await js<boolean>(`!!document.querySelector('.palette')`);
    key('Escape');
    await sleep(200);
    await js(`window.document.getElementById('audit-fake-popup')?.remove()`);
    flow('hidden-popup-does-not-block-keys', opened, `quick actions opened ${opened}`);

    // The shift is closed elsewhere while a bill waits in Sell.
    await openNamed('Shift');
    await focus('input');
    await js(`(() => { const label = [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Counted cash')); label?.nextElementSibling?.focus(); })()`);
    await type('0', 10);
    await js('void (window.alert = () => undefined)'); // the closing message would stop the page until someone presses OK
    await click('button.primary', 'Close shift');
    await sleep(800);
    await openNamed('Sell');
    await sleep(400);
    const asked = await js<boolean>(`!document.querySelector('input[aria-label="product search"]') && !!document.querySelector('button.primary')`);
    await click('button.primary');
    await waitFor(`document.querySelector('input[aria-label="product search"]')`);
    await sleep(300);
    flow('shift-closed-while-bill-held-in-sell', asked && (await lineCount()) === 1, `asked to open ${asked}, lines ${await lineCount()}`);
    await clearBill();
    await focus(box);
    await sleep(600);
  }

  /** Z on the payment step, F2, and the customer list on Sell. */
  async function sellStepFlows() {
    const box = 'input[aria-label="product search"]';
    const cust = '#customer-phone';
    const cashBox = 'input[aria-label="cash received"]';
    const code = '6281000000000';
    const held = () => js<number>(`document.querySelectorAll('button[aria-label^="cancel held bill"]').length`);
    const toPay = async () => {
      await focus(box);
      await sleep(450);
      key('Enter', ['shift']);
      await sleep(500);
    };
    await clearBill();
    await focus(box);
    await scan(code);
    await sleep(300);
    key('F2');
    await sleep(200);
    const onCust = (await js<string>('document.activeElement?.id ?? ""')) === 'customer-phone';
    flow('f2-keeps-bill', onCust && (await lineCount()) === 1, `focus on customer box ${onCust}, lines ${await lineCount()}`);

    await type('A', 20);
    await sleep(500);
    const rows = await js<number>(`document.querySelectorAll('[aria-label="customer suggestions"] li[role="option"]:not(.add-new)').length`);
    flow('customer-list-appears-first-letter', rows >= 1, `rows ${rows}`);
    await type('hmed', 20);
    await sleep(500);
    key('Enter');
    await sleep(250);
    const notPicked = await js<boolean>(`!!document.querySelector('#customer-phone')`);
    flow('customer-one-match-not-picked', notPicked, `box still open ${notPicked}`);
    key('Down');
    await sleep(100);
    key('Enter');
    await sleep(400);
    const picked = await js<boolean>(`!document.querySelector('#customer-phone') && document.body.textContent.includes('Ahmed Al-Ghamdi')`);
    flow('customer-arrow-enter-picks', picked, `customer on bill ${picked}`);

    await focus('input[aria-label="discount"]');
    await type('1', 20);
    await focus(box);
    await sleep(200);
    await toPay();
    await focus(cashBox);
    await type('5', 20);
    await sleep(100);
    const sales = hooks.salesCount();
    const heldBefore = await held();
    key('z');
    await sleep(600);
    flow('z-holds-on-payment', (await lineCount()) === 0 && (await held()) === heldBefore + 1, `lines ${await lineCount()}, held ${heldBefore} -> ${await held()}`);
    flow('z-no-sale-created', hooks.salesCount() === sales, `sales ${sales} -> ${hooks.salesCount()}`);

    await js(`[...document.querySelectorAll('button[aria-label^="cancel held bill"]')].at(-1).previousElementSibling.click()`);
    await sleep(500);
    const back = await js<{ lines: number; discount: string; customer: boolean; cash: string }>(`({ lines: document.querySelectorAll('.cart tbody tr').length, discount: document.querySelector('input[aria-label="discount"]')?.value ?? '', customer: document.body.textContent.includes('Ahmed Al-Ghamdi'), cash: document.querySelector('input[aria-label="cash received"]')?.value ?? '' })`);
    flow('held-bill-restores-discount-and-customer', back.lines === 1 && back.discount !== '' && back.customer && back.cash === '5', JSON.stringify(back));

    await js(`[...document.querySelectorAll('span')].find((s) => s.textContent.startsWith('Customer:'))?.querySelector('button')?.click()`);
    await sleep(200);
    await toPay();
    await focus(cust);
    await sleep(100);
    key('z');
    await sleep(300);
    const typed = await js<string>(`document.querySelector('#customer-phone')?.value ?? ''`);
    flow('z-types-in-other-box', typed === 'z' && (await lineCount()) === 1, `box "${typed}", lines ${await lineCount()}`);
    key('Backspace');
    await js(`document.querySelector('input[aria-label="cash received"]')?.select()`);
    await focus(cashBox);
    await js(`document.querySelector('input[aria-label="cash received"]')?.select()`);
    key('Backspace');
    await sleep(100);
    await clearBill();
    await focus(box);
    await sleep(100);
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
    // Each code is scanned once and doubled with "+": the same code twice within 400 ms opens a blocking
    // "scanned twice" confirm box, which would stall the audit.
    for (const code of ['6281000000000', '6281000000077']) {
      await scan(code);
      await focus('input[aria-label="product search"]');
      await sleep(400);
      key('+');
      await sleep(300);
    }
    await js(`(() => { const e = document.querySelector('.cart tbody tr input[aria-label="line quantity"]'); e.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, '0'); e.dispatchEvent(new Event('input', { bubbles: true })); e.blur(); })()`);
    await sleep(400);
    const left = await js<string[]>(`[...document.querySelectorAll('.cart tbody tr input[aria-label="line quantity"]')].map((i) => i.value)`);
    flow('type-zero-keeps-next-line', left.length === 1 && left[0] === '2', `quantities left: ${JSON.stringify(left)}`);
    // The "?" beside Payment opens help; coming back, the bill must still be there
    await click('.help-link');
    await sleep(400);
    const helpShown = await js<boolean>(`!!document.querySelector('.help-article')`);
    if (!(await click('.help-overlay .close'))) await js(`document.querySelectorAll('.top nav button')[0].click()`);
    await sleep(400);
    const kept = await lineCount();
    flow('help-link-keeps-bill', helpShown && kept === 1, `help shown: ${helpShown}, lines after coming back: ${kept}`);
    await clearBill();
  }
}
