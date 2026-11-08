import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from './context';
import { BLANK_STORE, getStoreDetails, saveStoreDetails, type StoreDetails } from './store-details';
import { makeTestCtx, seedUsers } from './test-helpers';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;

const store: StoreDetails = {
  ...BLANK_STORE,
  nameAr: 'متجر تجريبي', nameEn: 'Test Mart', legalNameAr: 'شركة تجريبية', legalNameEn: 'Test Mart Trading', vatNumber: '300000000000003', crNumber: '1234567890',
  mobile: '0500000000', buildingNo: '1111', street: 'Test Street', district: 'Test District', city: 'Test City', postalCode: '11111', additionalNo: '2222',
  addressLine: 'Test District - Test Street', footerAr: 'شكراً', footerEn: 'Thank you',
};

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
});
afterEach(() => t.cleanup());

describe('store details', () => {
  it('starts blank', () => {
    expect(getStoreDetails(ctx)).toEqual(BLANK_STORE);
  });

  it('saves and reads every field', () => {
    saveStoreDetails(ctx, u.admin, store);
    expect(getStoreDetails(ctx)).toEqual(store);
    saveStoreDetails(ctx, u.admin, { ...store, city: 'Other City' });
    expect(getStoreDetails(ctx).city).toBe('Other City');
  });

  it('refuses a bad VAT number', () => {
    expect(() => saveStoreDetails(ctx, u.admin, { ...store, vatNumber: '123' })).toThrow('VAT');
    expect(getStoreDetails(ctx)).toEqual(BLANK_STORE);
  });

  it('allows a blank VAT number', () => {
    saveStoreDetails(ctx, u.admin, { ...store, vatNumber: '' });
    expect(getStoreDetails(ctx).vatNumber).toBe('');
  });

  it('needs settings.manage', () => {
    expect(() => saveStoreDetails(ctx, u.cashier, store)).toThrow();
    expect(() => saveStoreDetails(ctx, u.supervisor, store)).toThrow();
  });

  it('refuses a logo over 200 KB or not PNG/JPEG', () => {
    expect(() => saveStoreDetails(ctx, u.admin, { ...store, logo: 'data:image/gif;base64,AA==' })).toThrow('logo');
    expect(() => saveStoreDetails(ctx, u.admin, { ...store, logo: `data:image/png;base64,${'A'.repeat(300_000)}` })).toThrow('logo');
    expect(() => saveStoreDetails(ctx, u.admin, { ...store, logo: 'data:image/png;base64,"><script>' })).toThrow('logo');
    saveStoreDetails(ctx, u.admin, { ...store, logo: 'data:image/png;base64,AAAA' });
    expect(getStoreDetails(ctx).logo).toBe('data:image/png;base64,AAAA');
  });

  it('writes an audit record, without the logo itself', () => {
    saveStoreDetails(ctx, u.admin, { ...store, logo: 'data:image/png;base64,AAAA' });
    const row = ctx.db.prepare("SELECT details_json FROM audit_log WHERE action = 'settings.store_details'").get() as { details_json: string };
    expect(row.details_json).not.toContain('AAAA');
  });
});
