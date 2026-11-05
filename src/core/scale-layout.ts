// Configurable scale-label layouts (ADR-3). Supports any field order, e.g. the owner's description
// "item code + quantity + PLU". The store's REAL layout is not known yet: it must be read off a real label.
// Nothing here assumes a scale brand. All arithmetic is on integers.

import { ean13CheckDigit } from './scale-barcode';

export type FieldKind = 'lit' | 'item' | 'plu' | 'weight_g' | 'weight_kg' | 'price' | 'pieces' | 'check' | 'skip';

export interface LayoutField {
  kind: FieldKind;
  length: number;
  literal?: string; // kind 'lit': these exact digits (e.g. the "21" prefix)
  decimals?: number; // kind 'weight_kg': digits after the decimal point (e.g. 3 => "01250" = 1.250 kg)
}

export interface ScaleLayout {
  id?: number;
  name: string;
  fields: LayoutField[];
  itemMatches: 'plu' | 'sku'; // what the 'item' field is looked up against
}

export interface ParsedLabel {
  raw: string;
  itemCode?: string;
  plu?: string;
  weightGrams?: number;
  priceHalalas?: number;
  pieces?: number;
}

const QTY_KINDS: FieldKind[] = ['weight_g', 'weight_kg', 'price', 'pieces'];

export function layoutLength(l: ScaleLayout): number {
  return l.fields.reduce((s, f) => s + f.length, 0);
}

/** Throws with a readable message if the layout cannot work. */
export function validateLayout(l: ScaleLayout): void {
  if (!l.name.trim()) throw new RangeError('Layout needs a name');
  if (l.fields.length === 0) throw new RangeError('Layout has no fields');
  for (const f of l.fields) {
    if (!Number.isInteger(f.length) || f.length < 1 || f.length > 13) throw new RangeError(`Field ${f.kind}: length must be 1–13`);
    if (f.kind === 'lit' && !(f.literal && /^\d+$/.test(f.literal) && f.literal.length === f.length)) throw new RangeError('Literal field must be digits of its length');
    if (f.kind === 'weight_kg' && !(Number.isInteger(f.decimals) && f.decimals! >= 0 && f.decimals! <= 6)) throw new RangeError('Weight in kg needs 0–6 decimals');
    if (f.kind === 'check' && f.length !== 1) throw new RangeError('Check digit is 1 digit');
  }
  const qty = l.fields.filter((f) => QTY_KINDS.includes(f.kind));
  if (qty.length !== 1) throw new RangeError('Layout needs exactly one quantity field (weight, price or pieces)');
  if (!l.fields.some((f) => f.kind === 'item' || f.kind === 'plu')) throw new RangeError('Layout needs an item code or a PLU field');
  if (l.fields.filter((f) => f.kind === 'item').length > 1 || l.fields.filter((f) => f.kind === 'plu').length > 1) throw new RangeError('Only one item and one PLU field');
  const checks = l.fields.filter((f) => f.kind === 'check');
  if (checks.length > 1) throw new RangeError('Only one check digit');
  if (checks.length === 1 && (l.fields.at(-1)!.kind !== 'check' || layoutLength(l) !== 13)) {
    throw new RangeError('The EAN-13 check digit must be the last of exactly 13 digits');
  }
  if (!l.fields.some((f) => f.kind === 'lit')) throw new RangeError('Layout needs a fixed prefix (lit), so normal barcodes are never read as scale labels');
}

/** True when the code has this layout's length and fixed digits, i.e. it is meant to be one of these labels. */
export function looksLike(code: string, l: ScaleLayout): boolean {
  if (code.length !== layoutLength(l) || !/^\d+$/.test(code)) return false;
  let pos = 0;
  for (const f of l.fields) {
    if (f.kind === 'lit' && code.slice(pos, pos + f.length) !== f.literal) return false;
    pos += f.length;
  }
  return true;
}

export class LabelError extends Error {}

/** Parses a label that looksLike() the layout. Throws LabelError for a damaged or impossible label. */
export function parseLabel(code: string, l: ScaleLayout): ParsedLabel {
  if (!looksLike(code, l)) throw new LabelError('Not this label layout');
  const out: ParsedLabel = { raw: code };
  let pos = 0;
  for (const f of l.fields) {
    const part = code.slice(pos, pos + f.length);
    pos += f.length;
    const n = Number(part);
    switch (f.kind) {
      case 'item': out.itemCode = part; break;
      case 'plu': out.plu = part; break;
      case 'weight_g': out.weightGrams = n; break;
      case 'weight_kg': {
        const d = f.decimals!;
        if (d <= 3) out.weightGrams = n * 10 ** (3 - d);
        else {
          const div = 10 ** (d - 3);
          if (n % div !== 0) throw new LabelError('Label weight is finer than 1 gram'); // never round a weight
          out.weightGrams = n / div;
        }
        break;
      }
      case 'price': out.priceHalalas = n; break;
      case 'pieces': out.pieces = n; break;
      case 'check':
        if (ean13CheckDigit(code.slice(0, 12)) !== n) throw new LabelError('Scale label barcode is damaged (check digit wrong). Re-scan or reprint the label.');
        break;
      case 'lit':
      case 'skip':
        break;
    }
  }
  return out;
}

/**
 * Layout written as text, for the settings screen. Fields in label order, separated by spaces or commas:
 *   lit=21        fixed digits
 *   item:5        item code, 5 digits      plu:4      PLU, 4 digits
 *   weight_g:5    weight in grams          weight_kg3:5   weight in kg with 3 decimals
 *   price:5       price in halalas         pieces:2   piece count
 *   skip:1        digits to ignore         check      EAN-13 check digit
 * Example (owner's described order, NOT verified): "lit=2 item:5 weight_g:5 plu:?"  — lengths must come from a real label.
 */
export function parseLayoutSpec(spec: string): LayoutField[] {
  const tokens = spec.trim().split(/[\s,]+/).filter(Boolean);
  return tokens.map((tok): LayoutField => {
    let m: RegExpExecArray | null;
    if ((m = /^lit=(\d+)$/.exec(tok))) return { kind: 'lit', length: m[1]!.length, literal: m[1] };
    if (tok === 'check') return { kind: 'check', length: 1 };
    if ((m = /^weight_kg(\d):(\d+)$/.exec(tok))) return { kind: 'weight_kg', decimals: Number(m[1]), length: Number(m[2]) };
    if ((m = /^(item|plu|weight_g|price|pieces|skip):(\d+)$/.exec(tok))) return { kind: m[1] as FieldKind, length: Number(m[2]) };
    throw new RangeError(`Unknown layout part "${tok}"`);
  });
}

export function layoutToSpec(fields: LayoutField[]): string {
  return fields
    .map((f) => (f.kind === 'lit' ? `lit=${f.literal}` : f.kind === 'check' ? 'check' : f.kind === 'weight_kg' ? `weight_kg${f.decimals}:${f.length}` : `${f.kind}:${f.length}`))
    .join(' ');
}
