import { describe, expect, it } from 'vitest';
import { billWarnings } from './bill-warnings';

describe('cost warnings on a supplier bill', () => {
  it('cost above shelf price excl. VAT warns', () => {
    expect(billWarnings({ costPerUnit: 800, avgCost: 790, shelfExcl: 783, hasStock: true })).toEqual(['above_shelf']);
  });

  it('24 entered as 2 warns far from average', () => {
    expect(billWarnings({ costPerUnit: 5_915, avgCost: 493, shelfExcl: 783, hasStock: true })).toEqual(['above_shelf', 'far_from_average']);
  });

  it('within 30% does not warn', () => {
    expect(billWarnings({ costPerUnit: 600, avgCost: 493, shelfExcl: 783, hasStock: true })).toEqual([]);
    expect(billWarnings({ costPerUnit: 346, avgCost: 493, shelfExcl: 783, hasStock: true })).toEqual([]);
  });

  it('far below average also warns', () => {
    expect(billWarnings({ costPerUnit: 300, avgCost: 493, shelfExcl: 783, hasStock: true })).toEqual(['far_from_average']);
  });

  it('no stock yet skips the average warning', () => {
    expect(billWarnings({ costPerUnit: 500, avgCost: 0, shelfExcl: 783, hasStock: false })).toEqual([]);
  });

  it('a free line never warns', () => {
    expect(billWarnings({ costPerUnit: 0, avgCost: 493, shelfExcl: 783, hasStock: true })).toEqual([]);
  });

  it('no shelf price set yet is not a warning', () => {
    expect(billWarnings({ costPerUnit: 500, avgCost: 0, shelfExcl: 0, hasStock: false })).toEqual([]);
  });
});
