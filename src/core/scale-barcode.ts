// Parses EAN-13 barcodes printed by label scales (plan §I, path A).
// Layout: <prefix><item code><value><check digit>, 13 digits in total.
// The exact layout must be copied from the client's scale configuration;
// nothing here assumes a particular scale brand.

export interface ScaleBarcodeFormat {
  prefix: string; // e.g. "20"–"29"
  itemDigits: number;
  valueDigits: number;
  embedded: 'weight' | 'price'; // weight in grams, or price in halalas
}

export interface ScaleBarcode {
  itemCode: string;
  weightGrams?: number;
  priceHalalas?: number;
}

export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new RangeError('need 12 digits');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

export function validateFormat(f: ScaleBarcodeFormat): void {
  if (!/^\d{1,3}$/.test(f.prefix)) throw new RangeError('prefix must be 1-3 digits');
  if (f.prefix.length + f.itemDigits + f.valueDigits !== 12) {
    throw new RangeError('prefix + item + value digits must equal 12');
  }
}

/** Returns null when the code is not a scale barcode for any configured format. */
export function parseScaleBarcode(code: string, formats: readonly ScaleBarcodeFormat[]): ScaleBarcode | null {
  if (!isValidEan13(code)) return null;
  for (const f of formats) {
    if (!code.startsWith(f.prefix)) continue;
    const start = f.prefix.length;
    const itemCode = code.slice(start, start + f.itemDigits);
    const value = Number(code.slice(start + f.itemDigits, start + f.itemDigits + f.valueDigits));
    return f.embedded === 'weight' ? { itemCode, weightGrams: value } : { itemCode, priceHalalas: value };
  }
  return null;
}
