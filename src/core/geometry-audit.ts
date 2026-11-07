/**
 * Pure layout checks over element rectangles collected from the real app (see src/main/ui-audit.ts).
 * Development tool only: nothing here runs in a normal till session.
 */
export interface Rect { x: number; y: number; w: number; h: number }
export interface BoxInfo {
  id: string;
  path: string;
  parent: string | null;
  role: 'button' | 'input' | 'select' | 'card' | 'tile' | 'th' | 'td' | 'other';
  /** Siblings that should line up: a flex row, form row, grid row, or `col:<n>` for a table column. */
  group: string | null;
  rect: Rect;
  /** Popovers, suggestion lists, badges, focus rings: allowed to overlap. */
  overlay: boolean;
  /** overflow other than visible: content outside is cut off. */
  clipsChildren: boolean;
  text?: string;
}
/** An element that scrolls sideways; hiddenScrollbar = the user gets no sign that more content is off to the side. */
export interface Scroller { id: string; scrollWidth: number; clientWidth: number; hiddenScrollbar: boolean }
export interface Snapshot { screen: string; viewport: { w: number; h: number }; scrollWidth: number; boxes: BoxInfo[]; scrollers?: Scroller[] }
export interface Finding {
  kind: 'overlap' | 'misaligned-top' | 'misaligned-height' | 'out-of-parent' | 'out-of-viewport' | 'page-overflow' | 'column-edge' | 'hidden-overflow';
  severity: 'high' | 'medium' | 'low';
  ids: string[];
  detail: string;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s[(s.length - 1) >> 1]!;
};
const r1 = (v: number) => Math.trunc(v * 10) / 10;

export function auditGeometry(s: Snapshot, tolerancePx = 1.5): Finding[] {
  const out: Finding[] = [];
  const byId = new Map(s.boxes.map((b) => [b.id, b]));

  if (s.scrollWidth > s.viewport.w + 1) {
    out.push({ kind: 'page-overflow', severity: 'high', ids: [], detail: `page is ${s.scrollWidth}px wide in a ${s.viewport.w}px window` });
  }

  for (const sc of s.scrollers ?? []) {
    if (sc.hiddenScrollbar && sc.scrollWidth > sc.clientWidth + 1) {
      out.push({ kind: 'hidden-overflow', severity: 'high', ids: [sc.id], detail: `${sc.scrollWidth - sc.clientWidth}px of content hidden sideways with no scrollbar` });
    }
  }

  // Overlaps between siblings
  const byParent = new Map<string | null, BoxInfo[]>();
  for (const b of s.boxes) byParent.set(b.parent, [...(byParent.get(b.parent) ?? []), b]);
  for (const sibs of byParent.values()) {
    const solid = sibs.filter((b) => !b.overlay && b.rect.w > 0 && b.rect.h > 0);
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) {
        const a = solid[i]!.rect;
        const b = solid[j]!.rect;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 1 && oy > 1) out.push({ kind: 'overlap', severity: 'high', ids: [solid[i]!.id, solid[j]!.id], detail: `overlap ${r1(ox)}×${r1(oy)}px` });
      }
    }
  }

  // Alignment inside groups
  const groups = new Map<string, BoxInfo[]>();
  for (const b of s.boxes) if (b.group) groups.set(b.group, [...(groups.get(b.group) ?? []), b]);
  for (const [g, members] of groups) {
    if (g.startsWith('col:')) {
      const head = members.find((m) => m.role === 'th');
      if (!head) continue;
      for (const c of members) {
        if (c === head) continue;
        const dl = Math.abs(c.rect.x - head.rect.x);
        const dr = Math.abs(c.rect.x + c.rect.w - (head.rect.x + head.rect.w));
        if (dl > tolerancePx || dr > tolerancePx) out.push({ kind: 'column-edge', severity: 'medium', ids: [head.id, c.id], detail: `column ${g.slice(4)} edges differ by ${r1(Math.max(dl, dr))}px` });
      }
      continue;
    }
    if (members.length < 2) continue;
    const top = median(members.map((m) => m.rect.y));
    const height = median(members.map((m) => m.rect.h));
    for (const m of members) {
      if (Math.abs(m.rect.y - top) > tolerancePx) out.push({ kind: 'misaligned-top', severity: 'medium', ids: [m.id], detail: `top ${r1(m.rect.y)} vs ${r1(top)} in ${g}` });
      if (Math.abs(m.rect.h - height) > tolerancePx) out.push({ kind: 'misaligned-height', severity: 'medium', ids: [m.id], detail: `height ${r1(m.rect.h)} vs ${r1(height)} in ${g}` });
    }
  }

  // Spill out of a clipping parent, or off the window
  for (const b of s.boxes) {
    const p = b.parent ? byId.get(b.parent) : undefined;
    if (p?.clipsChildren && !b.overlay) {
      const r = b.rect;
      const q = p.rect;
      const spill = Math.max(q.x - r.x, q.y - r.y, r.x + r.w - (q.x + q.w), r.y + r.h - (q.y + q.h));
      if (spill > 1) out.push({ kind: 'out-of-parent', severity: 'high', ids: [b.id], detail: `cut off by ${r1(spill)}px` });
    }
    if (b.rect.w > 0 && (b.rect.x < -1 || b.rect.x + b.rect.w > s.viewport.w + 1)) {
      out.push({ kind: 'out-of-viewport', severity: 'medium', ids: [b.id], detail: `x ${r1(b.rect.x)}..${r1(b.rect.x + b.rect.w)} outside 0..${s.viewport.w}` });
    }
  }
  return out;
}
