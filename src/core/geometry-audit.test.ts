import { describe, expect, it } from 'vitest';
import { auditGeometry, type BoxInfo, type Snapshot } from './geometry-audit';

let n = 0;
const box = (p: Partial<BoxInfo> & { rect: BoxInfo['rect'] }): BoxInfo => ({
  id: p.id ?? `b${++n}`,
  path: p.path ?? 'div',
  parent: p.parent === undefined ? 'root' : p.parent,
  role: p.role ?? 'other',
  group: p.group ?? null,
  rect: p.rect,
  overlay: p.overlay ?? false,
  clipsChildren: p.clipsChildren ?? false,
});
const snap = (boxes: BoxInfo[], extra: Partial<Snapshot> = {}): Snapshot => ({ screen: 't', viewport: { w: 1000, h: 800 }, scrollWidth: 1000, boxes, ...extra });
const kinds = (s: Snapshot) => auditGeometry(s).map((f) => f.kind);

describe('auditGeometry', () => {
  it('flags siblings that overlap', () => {
    const f = auditGeometry(snap([box({ id: 'a', rect: { x: 0, y: 0, w: 100, h: 40 } }), box({ id: 'b', rect: { x: 90, y: 0, w: 100, h: 40 } })]));
    expect(f.filter((x) => x.kind === 'overlap').map((x) => x.ids.sort())).toEqual([['a', 'b']]);
  });

  it('ignores overlaps of overlay boxes and 1 px touches', () => {
    expect(kinds(snap([box({ rect: { x: 0, y: 0, w: 100, h: 40 } }), box({ overlay: true, rect: { x: 10, y: 10, w: 100, h: 40 } })]))).not.toContain('overlap');
    expect(kinds(snap([box({ rect: { x: 0, y: 0, w: 100, h: 40 } }), box({ rect: { x: 99.5, y: 0, w: 100, h: 40 } })]))).not.toContain('overlap');
  });

  it('flags a button whose top is off by more than 1.5 px in its group', () => {
    const b = (id: string, y: number) => box({ id, role: 'button', group: 'g', rect: { x: Number(id.slice(1)) * 120, y, w: 100, h: 36 } });
    const f = auditGeometry(snap([b('x1', 10), b('x2', 10), b('x3', 13)])).filter((x) => x.kind === 'misaligned-top');
    expect(f).toHaveLength(1);
    expect(f[0]!.ids).toEqual(['x3']);
    expect(kinds(snap([b('x1', 10), b('x2', 11), b('x3', 10)]))).not.toContain('misaligned-top');
  });

  it('flags a different height in a group', () => {
    const b = (i: number, h: number) => box({ role: 'input', group: 'row', rect: { x: i * 120, y: 0, w: 100, h } });
    expect(kinds(snap([b(0, 36), b(1, 36), b(2, 32)]))).toContain('misaligned-height');
  });

  it('flags a child that spills out of a clipping parent as high', () => {
    const f = auditGeometry(snap([
      box({ id: 'p', clipsChildren: true, rect: { x: 0, y: 0, w: 100, h: 100 } }),
      box({ id: 'c', parent: 'p', rect: { x: 0, y: 0, w: 105, h: 20 } }),
    ])).find((x) => x.kind === 'out-of-parent');
    expect(f?.severity).toBe('high');
    expect(f?.ids).toEqual(['c']);
  });

  it('flags horizontal page overflow as high', () => {
    const f = auditGeometry(snap([], { scrollWidth: 1010 })).find((x) => x.kind === 'page-overflow');
    expect(f?.severity).toBe('high');
    expect(kinds(snap([], { scrollWidth: 1001 }))).not.toContain('page-overflow');
  });

  it('flags a table header edge that does not line up with its column', () => {
    const f = auditGeometry(snap([
      box({ id: 'h', role: 'th', group: 'col:1', rect: { x: 100, y: 0, w: 80, h: 30 } }),
      box({ id: 'd1', role: 'td', group: 'col:1', parent: 'r1', rect: { x: 100, y: 30, w: 80, h: 30 } }),
      box({ id: 'd2', role: 'td', group: 'col:1', parent: 'r2', rect: { x: 104, y: 60, w: 80, h: 30 } }),
    ])).filter((x) => x.kind === 'column-edge');
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe('medium');
    expect(f[0]!.ids).toContain('d2');
  });

  it('flags elements outside the viewport horizontally', () => {
    expect(kinds(snap([box({ rect: { x: 950, y: 0, w: 100, h: 20 } })]))).toContain('out-of-viewport');
  });

  it('flags content hidden in a sideways scroll area whose scrollbar is hidden', () => {
    const f = auditGeometry(snap([], { scrollers: [{ id: 'nav', scrollWidth: 1100, clientWidth: 865, hiddenScrollbar: true }] })).find((x) => x.kind === 'hidden-overflow');
    expect(f?.severity).toBe('high');
    expect(f?.ids).toEqual(['nav']);
    expect(kinds(snap([], { scrollers: [{ id: 'nav', scrollWidth: 866, clientWidth: 865, hiddenScrollbar: true }] }))).not.toContain('hidden-overflow');
    expect(kinds(snap([], { scrollers: [{ id: 'cart', scrollWidth: 1100, clientWidth: 865, hiddenScrollbar: false }] }))).not.toContain('hidden-overflow');
  });
});
