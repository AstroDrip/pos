import { appendAudit } from './audit';
import { DomainError, type Ctx } from './context';
import { requirePermission } from './users';

export interface StoreDetails {
  nameAr: string;
  nameEn: string;
  legalNameAr: string;
  legalNameEn: string;
  vatNumber: string;
  crNumber: string;
  mobile: string;
  buildingNo: string;
  street: string;
  district: string;
  city: string;
  postalCode: string;
  additionalNo: string;
  addressLine: string;
  logo: string;
  footerAr: string;
  footerEn: string;
}

const KEYS: Record<keyof StoreDetails, string> = {
  nameAr: 'store_name_ar',
  nameEn: 'store_name_en',
  legalNameAr: 'store_legal_name_ar',
  legalNameEn: 'store_legal_name_en',
  vatNumber: 'store_vat_number',
  crNumber: 'store_cr_number',
  mobile: 'store_mobile',
  buildingNo: 'store_building_no',
  street: 'store_street',
  district: 'store_district',
  city: 'store_city',
  postalCode: 'store_postal_code',
  additionalNo: 'store_additional_no',
  addressLine: 'store_address_line',
  logo: 'store_logo',
  footerAr: 'store_footer_ar',
  footerEn: 'store_footer_en',
};
const FIELDS = Object.keys(KEYS) as (keyof StoreDetails)[];

export const BLANK_STORE: StoreDetails = Object.fromEntries(FIELDS.map((f) => [f, ''])) as unknown as StoreDetails;

const MAX_LOGO_BYTES = 200 * 1024;
const LOGO = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

function logoOk(logo: string): boolean {
  if (!logo) return true;
  const m = LOGO.exec(logo);
  return !!m && Math.floor((m[2]!.length * 3) / 4) <= MAX_LOGO_BYTES;
}

export function getStoreDetails(ctx: Ctx): StoreDetails {
  const read = ctx.db.prepare('SELECT value FROM settings WHERE key = ?');
  return Object.fromEntries(FIELDS.map((f) => [f, (read.get(KEYS[f]) as { value: string } | undefined)?.value ?? ''])) as unknown as StoreDetails;
}

export function saveStoreDetails(ctx: Ctx, userId: number, details: StoreDetails): void {
  requirePermission(ctx, userId, 'settings.manage');
  const clean = Object.fromEntries(FIELDS.map((f) => [f, (details[f] ?? '').trim()])) as unknown as StoreDetails;
  if (clean.vatNumber && !/^3\d{13}3$/.test(clean.vatNumber)) throw new DomainError('VALIDATION', 'VAT number must be 15 digits starting and ending with 3');
  if (!logoOk(clean.logo)) throw new DomainError('VALIDATION', 'The logo must be a PNG or JPEG file of 200 KB or less');
  const write = ctx.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  ctx.db.transaction(() => {
    const old = Object.fromEntries(FIELDS.map((f) => [f, (ctx.db.prepare('SELECT value FROM settings WHERE key = ?').get(KEYS[f]) as { value: string } | undefined)?.value ?? '']));
    const before = { ...old, logo: old.logo ? '(logo)' : '' };
    for (const f of FIELDS) write.run(KEYS[f], clean[f]);
    appendAudit(ctx, { userId, action: 'settings.store_details', entity: 'settings', entityId: 0, details: { ...clean, logo: clean.logo ? 'set' : '' } , before, after: { ...clean, logo: clean.logo ? '(logo)' : '' } });
  })();
}
