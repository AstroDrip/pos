export type BillWarning = 'above_shelf' | 'far_from_average';

const FAR_BP = 3_000; // 30%

/** Costs that look wrong on a bill line. A wrong pack size (24 typed as 2) shows up here before saving. */
export function billWarnings(line: { costPerUnit: number; avgCost: number; shelfExcl: number; hasStock: boolean }): BillWarning[] {
  const out: BillWarning[] = [];
  if (line.costPerUnit === 0) return out; // a free line
  if (line.shelfExcl > 0 && line.costPerUnit > line.shelfExcl) out.push('above_shelf');
  if (line.hasStock && line.avgCost > 0 && Math.abs(line.costPerUnit - line.avgCost) * 10_000 > line.avgCost * FAR_BP) out.push('far_from_average');
  return out;
}
