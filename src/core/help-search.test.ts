import { describe, expect, it } from 'vitest';
import { searchHelp } from './help-search';

const A = [
  { id: 'qty', title: 'Change a quantity', keywords: ['minus', 'plus'] },
  { id: 'cash', title: 'Take a payment', keywords: ['cash', 'card', 'change'] },
  { id: 'cust', title: 'Find or add a customer', keywords: ['phone'] },
  { id: 'close', title: 'Close a shift', keywords: ['count cash'] },
];
const ids = (q: string) => searchHelp(A, q).map((a) => a.id);

describe('searchHelp', () => {
  it('finds from the first letter, case-insensitive', () => {
    expect(ids('c')).toEqual(expect.arrayContaining(['qty', 'cash', 'cust', 'close']));
    expect(ids('C')).toEqual(ids('c'));
  });
  it('ranks title starts > title word starts > keyword starts > anywhere', () => {
    expect(ids('c').slice(0, 2)).toEqual(['qty', 'close']); // titles starting with c, in content order
    expect(ids('pay')).toEqual(['cash']); // word in the title
    expect(ids('cash')).toEqual(['cash', 'close']); // keyword "cash" before keyword phrase "count cash"
    expect(ids('min')).toEqual(['qty']);
  });
  it('returns everything for blank text, nothing for no match', () => {
    expect(ids('  ')).toEqual(['qty', 'cash', 'cust', 'close']);
    expect(ids('zzz')).toEqual([]);
  });
  it('matches every word typed', () => {
    expect(ids('close cash')).toEqual(['close']);
  });
});
