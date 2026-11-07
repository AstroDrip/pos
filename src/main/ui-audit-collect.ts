/**
 * In-page collector for the development UI audit (src/main/ui-audit.ts). It is kept as source text so the main
 * process tsconfig needs no DOM types; it is only ever evaluated when POS_UI_AUDIT is set in an unpackaged build.
 * It returns raw rectangles (a Snapshot without `screen`); the checks themselves are in src/core/geometry-audit.ts.
 */
export const COLLECT_SOURCE = String.raw`(() => {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'OPTION', 'BR', 'HEAD', 'META', 'LINK', 'TITLE', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon']);
  const OVERLAY_CLASS = /(suggest|dropdown|popover|badge|tooltip|toast|undo-bar)/i;
  let seq = 0;
  const idOf = new Map();
  const boxes = [];
  const roleOf = (el) => {
    const tag = el.tagName;
    if (tag === 'BUTTON') return 'button';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return 'input';
    if (tag === 'SELECT') return 'select';
    if (tag === 'TH') return 'th';
    if (tag === 'TD') return 'td';
    if (el.classList.contains('kpi')) return 'tile';
    if (el.classList.contains('card') || el.classList.contains('subpanel')) return 'card';
    return 'other';
  };
  const visible = (el, cs, r) => cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  const walk = (el, parentId, overlayAncestor) => {
    if (SKIP.has(el.tagName)) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    const r = el.getBoundingClientRect();
    let myId = parentId;
    const overlay = overlayAncestor || cs.position === 'absolute' || cs.position === 'fixed' || OVERLAY_CLASS.test(el.className && el.className.baseVal === undefined ? el.className : '');
    if (visible(el, cs, r) && el !== document.body) {
      myId = 'e' + (++seq);
      idOf.set(el, myId);
      const tag = el.tagName.toLowerCase();
      const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '';
      const label = el.getAttribute('aria-label');
      boxes.push({
        id: myId,
        path: tag + cls + (label ? '[' + label + ']' : ''),
        parent: parentId,
        role: roleOf(el),
        group: null,
        rect: { x: r.left, y: r.top, w: r.width, h: r.height },
        overlay,
        clipsChildren: cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.overflowY === 'hidden' || cs.overflowY === 'clip',
        text: (el.innerText || el.value || '').trim().slice(0, 40),
        _el: el,
      });
    }
    for (const c of el.children) walk(c, myId, overlay);
  };
  walk(document.body, null, false);

  // Groups: controls (and tiles, cards) that sit on the same visual line inside the same parent should line up.
  const byParent = new Map();
  for (const b of boxes) {
    if (b.overlay) continue;
    const kind = b.role === 'button' || b.role === 'input' || b.role === 'select' ? 'ctl' : b.role === 'tile' || b.role === 'card' ? b.role : null;
    if (!kind) continue;
    const k = b.parent + '|' + kind;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(b);
  }
  for (const [k, list] of byParent) {
    list.sort((a, b) => a.rect.y - b.rect.y);
    let line = 0;
    let lineMid = null;
    for (const b of list) {
      const mid = b.rect.y + b.rect.h / 2;
      if (lineMid !== null && Math.abs(mid - lineMid) > Math.max(8, b.rect.h / 2)) line++;
      lineMid = mid;
      b.group = k + '|L' + line;
    }
  }
  // Table columns: header cells against body cells, rows without colspan only.
  document.querySelectorAll('table').forEach((tbl, ti) => {
    for (const row of tbl.rows) {
      if ([...row.cells].some((c) => c.colSpan > 1)) continue;
      [...row.cells].forEach((cell, ci) => {
        const id = idOf.get(cell);
        const b = id && boxes.find((x) => x.id === id);
        if (b) b.group = 'col:' + ti + ':' + ci;
      });
    }
  });
  const de = document.documentElement;
  return {
    viewport: { w: de.clientWidth, h: de.clientHeight },
    scrollWidth: de.scrollWidth,
    scrollHeight: de.scrollHeight,
    boxes: boxes.map(({ _el, ...b }) => b),
  };
})()`;

/** Outlines the given element ids (from the last collect) for the overlay screenshot; returns a cleanup script. */
export const outlineSource = (ids: string[]) => String.raw`(() => {
  const want = new Set(${JSON.stringify(ids)});
  let seq = 0;
  const marked = [];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'OPTION', 'BR', 'HEAD', 'META', 'LINK', 'TITLE', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon']);
  const walk = (el) => {
    if (SKIP.has(el.tagName)) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    const r = el.getBoundingClientRect();
    if (cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && el !== document.body) {
      const id = 'e' + (++seq);
      if (want.has(id)) { el.setAttribute('data-ui-audit', '1'); marked.push(el); }
    }
    for (const c of el.children) walk(c);
  };
  walk(document.body);
  const st = document.createElement('style');
  st.id = 'ui-audit-outline';
  st.textContent = '[data-ui-audit]{outline:2px solid #e00 !important;outline-offset:-1px !important}';
  document.head.appendChild(st);
  return marked.length;
})()`;

export const CLEAR_OUTLINE_SOURCE = String.raw`(() => {
  document.getElementById('ui-audit-outline')?.remove();
  document.querySelectorAll('[data-ui-audit]').forEach((e) => e.removeAttribute('data-ui-audit'));
  return true;
})()`;
