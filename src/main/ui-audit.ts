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
    flow('ctrl-k-opens-on-sell', (await isOpen()) && ['P', 'C', 'H', 'R', 'I', 'M'].every((x) => shown.includes(x)) && !shown.includes('S'), `letters: ${shown.join(' ')}`);
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

    // M is refused with a bill on screen, so the bill cannot be lost
    await ctrlK();
    await letter('m');
    flow('quick-m-refused-with-bill', (await isOpen()) && (await lineCount()) === 1, `open ${await isOpen()}`);
    await esc();

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
    const stillSell = await js<boolean>(`document.querySelector('.top nav button.active')?.textContent.trim().endsWith('Sell')`);
    flow('palette-rechecks-before-running', stillSell && (await lineCount()) === 1, `on sell ${stillSell}, lines ${await lineCount()}`);
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
    const expected: Record<string, string[]> = { Customers: ['C', 'M'], Stock: ['P', 'I'], Products: ['P', 'I'], Purchases: ['P', 'S', 'I', 'M'], Accounting: [] };
    for (const [name, letters] of Object.entries(expected)) {
      await tabTo(name);
      await js('document.activeElement?.blur()');
      await ctrlK();
      const got = await rows();
      const empty = await js<boolean>(`!!document.querySelector('.palette .none')`);
      flow(`ctrl-k-on-${name.toLowerCase()}`, got.slice().sort().join() === letters.slice().sort().join() && (letters.length > 0 || empty), `letters: ${got.join(' ')}`);
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
