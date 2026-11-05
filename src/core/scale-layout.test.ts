import { describe, expect, it } from 'vitest';
import { ean13CheckDigit } from './scale-barcode';
import { LabelError, layoutToSpec, looksLike, parseLabel, parseLayoutSpec, validateLayout, type ScaleLayout } from './scale-layout';

const L = (spec: string, itemMatches: 'plu' | 'sku' = 'plu'): ScaleLayout => ({ name: 't', fields: parseLayoutSpec(spec), itemMatches });
const ean = (s12: string) => s12 + ean13CheckDigit(s12);

// SYNTHETIC layouts only. The store's real label layout is unknown until a real label is decoded.
describe('scale label layouts (ADR-3, synthetic)', () => {
  it('owner-described order: item code, quantity, PLU (example lengths)', () => {
    const l = L('lit=2 item:4 weight_g:5 plu:3');
    validateLayout(l);
    expect(parseLabel('2' + '0042' + '01250' + '125', l)).toEqual({ raw: '2004201250125', itemCode: '0042', weightGrams: 1250, plu: '125' });
  });

  it('quantity values 0, 1, 100, 250, 500, 1000 and maximum are read exactly (unit conversion only)', () => {
    const g = L('lit=2 item:4 weight_g:5 plu:3');
    const kg3 = L('lit=2 item:4 weight_kg3:5 plu:3');
    const kg2 = L('lit=2 item:4 weight_kg2:5 plu:3');
    for (const v of [0, 1, 100, 250, 500, 1000, 99999]) {
      const digits = String(v).padStart(5, '0');
      expect(parseLabel(`20042${digits}125`, g).weightGrams).toBe(v);
      expect(parseLabel(`20042${digits}125`, kg3).weightGrams).toBe(v); // kg with 3 decimals = grams
      expect(parseLabel(`20042${digits}125`, kg2).weightGrams).toBe(v * 10); // 00125 = 1.25 kg = 1250 g
    }
  });

  it('weights finer than a gram are refused, never rounded', () => {
    const kg4 = L('lit=2 item:4 weight_kg4:5 plu:3');
    expect(parseLabel('2004212500125', kg4).weightGrams).toBe(1250);
    expect(() => parseLabel('2004212501125', kg4)).toThrow(LabelError);
  });

  it('leading zeros are kept in codes and ignored in quantities', () => {
    const r = parseLabel('2000700050007', L('lit=2 item:4 weight_g:5 plu:3'));
    expect(r).toMatchObject({ itemCode: '0007', weightGrams: 50, plu: '007' });
  });

  it('EAN-13 layouts check the check digit; wrong digit is refused', () => {
    const l = L('lit=21 item:5 weight_g:5 check');
    validateLayout(l);
    const good = ean('210012301235');
    expect(parseLabel(good, l)).toMatchObject({ itemCode: '00123', weightGrams: 1235 });
    const bad = good.slice(0, 12) + ((Number(good[12]) + 1) % 10);
    expect(() => parseLabel(bad, l)).toThrow(/check digit/);
  });

  it('wrong length, letters, or wrong prefix are not this layout (so normal barcodes are never misread)', () => {
    const l = L('lit=2 item:4 weight_g:5 plu:3');
    expect(looksLike('200420125012', l)).toBe(false); // truncated
    expect(looksLike('20042012501255', l)).toBe(false); // too long
    expect(looksLike('2004201250A25', l)).toBe(false);
    expect(looksLike('6281000000014', l)).toBe(false); // ordinary product barcode, different prefix
  });

  it('layout validation rejects unsafe layouts', () => {
    expect(() => validateLayout(L('item:5 weight_g:5'))).toThrow(/fixed prefix/);
    expect(() => validateLayout(L('lit=2 item:5 plu:5'))).toThrow(/quantity/);
    expect(() => validateLayout(L('lit=2 weight_g:5 price:5'))).toThrow(/quantity/);
    expect(() => validateLayout(L('lit=2 weight_g:5'))).toThrow(/item code or a PLU/);
    expect(() => validateLayout(L('lit=2 check item:5 weight_g:5'))).toThrow(/check digit/);
    expect(() => parseLayoutSpec('lit=2 qty:5')).toThrow(/Unknown/);
  });

  it('spec text round-trips', () => {
    const spec = 'lit=21 item:5 weight_kg3:5 check';
    expect(layoutToSpec(parseLayoutSpec(spec))).toBe(spec);
  });
});
