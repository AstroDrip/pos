import { describe, expect, it } from 'vitest';
import { ean13CheckDigit, isValidEan13, parseScaleBarcode, validateFormat, type ScaleBarcodeFormat } from './scale-barcode';
import { ScanBuffer } from './scan-buffer';

const weightFmt: ScaleBarcodeFormat = { prefix: '21', itemDigits: 5, valueDigits: 5, embedded: 'weight' };
const priceFmt: ScaleBarcodeFormat = { prefix: '22', itemDigits: 5, valueDigits: 5, embedded: 'price' };

function withCheck(first12: string): string {
  return first12 + ean13CheckDigit(first12);
}

describe('scale barcodes', () => {
  it('validates EAN-13 check digits', () => {
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('4006381333932')).toBe(false);
  });
  it('parses embedded weight and price', () => {
    expect(parseScaleBarcode(withCheck('210012301235'), [weightFmt, priceFmt])).toEqual({ itemCode: '00123', weightGrams: 1235 });
    expect(parseScaleBarcode(withCheck('220012300987'), [weightFmt, priceFmt])).toEqual({ itemCode: '00123', priceHalalas: 987 });
  });
  it('ignores normal product barcodes and bad check digits', () => {
    expect(parseScaleBarcode('4006381333931', [weightFmt])).toBeNull();
    // Correct check digit for 210012301235 is 0, so 1 is wrong.
    expect(parseScaleBarcode('2100123012351', [weightFmt])).toBeNull();
  });
  it('rejects inconsistent formats', () => {
    expect(() => validateFormat({ ...weightFmt, valueDigits: 4 })).toThrow();
  });
});

describe('ScanBuffer', () => {
  const type = (buf: ScanBuffer, text: string, start: number, gap: number) => {
    let t = start;
    let result = null;
    for (const ch of text) result = buf.key(ch, (t += gap)) ?? result;
    return buf.key('Enter', t + gap) ?? result;
  };

  it('detects a fast scanner burst', () => {
    expect(type(new ScanBuffer(), '6281000000014', 0, 5)).toEqual({ code: '6281000000014', possibleDuplicate: false });
  });
  it('ignores slow human typing', () => {
    expect(type(new ScanBuffer(), '1234', 0, 200)).toBeNull();
  });
  it('flags a double scan inside the window but not after it', () => {
    const buf = new ScanBuffer();
    type(buf, '6281000000014', 0, 5);
    expect(type(buf, '6281000000014', 200, 5)?.possibleDuplicate).toBe(true);
    expect(type(buf, '6281000000014', 2000, 5)?.possibleDuplicate).toBe(false);
  });
  it('two rapid different scans are both captured', () => {
    const buf = new ScanBuffer();
    expect(type(buf, '1111111', 0, 5)?.code).toBe('1111111');
    expect(type(buf, '2222222', 100, 5)?.code).toBe('2222222');
  });
});
