/** True when a saved supplier bill can safely be put back on the screen. Anything else is thrown away, not shown. */
export function isSupplierDraft(v: unknown): boolean {
  const d = v as { key?: unknown; head?: { docNo?: unknown; supplierId?: unknown } | null; paper?: unknown; rows?: unknown } | null;
  if (!d || typeof d.key !== 'string' || !d.head || typeof d.head.docNo !== 'string' || typeof d.head.supplierId !== 'number') return false;
  if (typeof d.paper !== 'object' || d.paper === null || !Array.isArray(d.rows)) return false;
  return d.rows.every((r: { uid?: unknown; product?: unknown } | null) => !!r && typeof r.uid === 'string' && typeof r.product === 'object' && r.product !== null);
}
