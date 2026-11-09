// A made-up shop for trying the app (npm run demo). Never bundled in the installer.
// Every record goes through the app's own services with the clock moved back, so VAT, stock, invoice numbers,
// the accounts and the audit trail are all produced by the real rules. All names and numbers are fictional.

import { MILLI_PER_UNIT, roundDiv } from '../core/money';
import { ean13CheckDigit } from '../core/scale-barcode';
import { storeDay } from '../core/store-time';
import { computeBill } from '../core/supplier-bill';
import { computeInvoice } from '../core/vat';
import { postStockCount, recordWastage } from '../services/adjustments';
import { createProduct, setPrice, setProductActive } from '../services/catalog';
import type { Ctx } from '../services/context';
import { creditCheck, openInvoicesOf, recordCustomerReceipt, reverseCustomerReceipt, setInvoiceDispute, updateCustomerCredit, writeOffInvoice } from '../services/credit';
import { createExpense, generateRecurring, listCategories, postExpense, prepaidPreview, recognizePrepaidMonth, reverseExpense, saveRecurring, type VatClass } from '../services/expenses';
import { holdBill, listHeldBills, recallBill, recordRemoval } from '../services/held-bills';
import { postEntry } from '../services/ledger';
import { createCustomer, createSupplier } from '../services/parties';
import { createPurchaseInvoice, createPurchaseReturn, paySupplier, setSupplierOpeningBalance } from '../services/purchasing';
import { createRefund } from '../services/refunds';
import { finalizeSale, type PaymentInput } from '../services/sales';
import { saveStoreDetails } from '../services/store-details';
import { createSupplierBill, type DocType, type SupplierBillLine } from '../services/supplier-bills';
import { closeShift, openShift, recordCashMovement, shiftSummary } from '../services/shifts';
import { createUser } from '../services/users';

export interface DemoSummary {
  owner: number;
  days: number;
  sales: number;
}

export const DEMO_LOGINS = [
  { username: 'owner', displayName: 'Owner (demo)', pin: '4321', roles: ['admin'] },
  { username: 'supervisor', displayName: 'Huda (supervisor)', pin: '2222', roles: ['supervisor'] },
  { username: 'cashier', displayName: 'Yasir (cashier)', pin: '1111', roles: ['cashier'] },
  { username: 'cashier2', displayName: 'Lina (cashier)', pin: '3333', roles: ['cashier'] },
];

const SUPPLIERS = [
  { name: 'Golden Valley Dairy', terms: 7, agent: 'Omar' },
  { name: 'Red Sea Foods Trading', terms: 30, agent: 'Faisal' },
  { name: 'Jeddah Fresh Produce', terms: 0, agent: 'Bilal' },
  { name: 'Sunrise Bakery', terms: 0, agent: 'Tariq' },
  { name: 'Al Waha Beverages', terms: 14, agent: 'Majid' },
  { name: 'Home Care Wholesale', terms: 30, agent: 'Nasser' },
];

// sku, Arabic, English, price in halalas, supplier, pack name, pieces in a pack, how well it sells (1-5)
type Row = [string, string, string, number, number, string, number, number];
const PIECES: Row[] = [
  ['MLK1', 'حليب طازج ١ لتر', 'Fresh milk 1L', 650, 0, 'Crate', 12, 5],
  ['LBN1', 'لبن ١ لتر', 'Laban 1L', 600, 0, 'Crate', 12, 4],
  ['YOG6', 'زبادي ٦ حبات', 'Yoghurt 6 pack', 1200, 0, 'Carton', 6, 3],
  ['CHS5', 'جبن أبيض ٥٠٠ جم', 'White cheese 500g', 1450, 0, 'Carton', 12, 3],
  ['BUT2', 'زبدة ٢٠٠ جم', 'Butter 200g', 1100, 0, 'Carton', 24, 2],
  ['EGG30', 'بيض ٣٠ حبة', 'Eggs tray of 30', 2200, 0, 'Case', 6, 4],
  ['CRM1', 'قشطة ١٧٠ جم', 'Cream 170g', 450, 0, 'Carton', 24, 2],
  ['RICE5', 'أرز بسمتي ٥ كجم', 'Basmati rice 5kg', 3200, 1, 'Bag bale', 4, 4],
  ['SUG2', 'سكر ٢ كجم', 'Sugar 2kg', 950, 1, 'Carton', 10, 4],
  ['OIL18', 'زيت دوار الشمس ١.٨ لتر', 'Sunflower oil 1.8L', 1895, 1, 'Carton', 6, 3],
  ['FLR5', 'دقيق ٥ كجم', 'Flour 5kg', 1650, 1, 'Bag bale', 4, 2],
  ['LEN1', 'عدس ١ كجم', 'Lentils 1kg', 850, 1, 'Carton', 12, 2],
  ['CHK4', 'حمص معلب ٤٠٠ جم', 'Tinned chickpeas 400g', 325, 1, 'Carton', 24, 3],
  ['TUNA', 'تونة ١٨٥ جم', 'Tuna 185g', 750, 1, 'Carton', 48, 4],
  ['TPAS', 'معجون طماطم ٤٠٠ جم', 'Tomato paste 400g', 425, 1, 'Carton', 24, 3],
  ['PAST', 'مكرونة ٤٠٠ جم', 'Pasta 400g', 350, 1, 'Carton', 20, 4],
  ['SALT', 'ملح ٧٣٧ جم', 'Salt 737g', 250, 1, 'Carton', 24, 1],
  ['TEA1', 'شاي أحمر ١٠٠ كيس', 'Black tea 100 bags', 1450, 1, 'Carton', 12, 4],
  ['COF2', 'قهوة عربية ٢٥٠ جم', 'Arabic coffee 250g', 2850, 1, 'Carton', 12, 3],
  ['DAT1', 'تمر سكري ١ كجم', 'Sukkari dates 1kg', 3500, 1, 'Carton', 8, 3],
  ['HON5', 'عسل ٥٠٠ جم', 'Honey 500g', 4200, 1, 'Carton', 12, 1],
  ['JAM4', 'مربى فراولة ٤٠٠ جم', 'Strawberry jam 400g', 950, 1, 'Carton', 12, 2],
  ['MAYO', 'مايونيز ٤٧٣ مل', 'Mayonnaise 473ml', 1150, 1, 'Carton', 12, 2],
  ['KETC', 'كاتشب ٣٤٠ جم', 'Ketchup 340g', 725, 1, 'Carton', 24, 2],
  ['SPIC', 'بهارات مشكلة ١٠٠ جم', 'Mixed spice 100g', 650, 1, 'Carton', 24, 2],
  ['CORN', 'ذرة معلبة ٣٤٠ جم', 'Tinned corn 340g', 475, 1, 'Carton', 24, 2],
  ['BISC', 'بسكويت ١٠٠ جم', 'Biscuits 100g', 200, 1, 'Carton', 48, 5],
  ['CHIP', 'شيبس ٨٠ جم', 'Crisps 80g', 300, 1, 'Carton', 36, 5],
  ['CHOC', 'شوكولاتة ٤٥ جم', 'Chocolate bar 45g', 350, 1, 'Carton', 48, 4],
  ['BRD6', 'خبز عربي ٦ حبات', 'Arabic bread 6 pack', 200, 3, 'Tray', 20, 5],
  ['BUNS', 'خبز برجر ٦ حبات', 'Burger buns 6 pack', 550, 3, 'Tray', 12, 3],
  ['TOST', 'خبز توست', 'Toast loaf', 600, 3, 'Tray', 10, 4],
  ['CROI', 'كرواسون', 'Croissant', 250, 3, 'Tray', 24, 3],
  ['SAMN', 'صامولي ٦ حبات', 'Samoli rolls 6 pack', 400, 3, 'Tray', 12, 2],
  ['CAKE', 'كيك ٢٠٠ جم', 'Sponge cake 200g', 800, 3, 'Tray', 12, 2],
  ['WAT15', 'ماء ١.٥ لتر', 'Water 1.5L', 250, 4, 'Shrink', 6, 5],
  ['WAT33', 'ماء ٣٣٠ مل', 'Water 330ml', 100, 4, 'Carton', 40, 5],
  ['COLA', 'مشروب غازي علبة', 'Cola can 330ml', 300, 4, 'Tray', 24, 5],
  ['ORJ1', 'عصير برتقال ١ لتر', 'Orange juice 1L', 900, 4, 'Carton', 6, 3],
  ['MNG1', 'عصير مانجو ١ لتر', 'Mango juice 1L', 950, 4, 'Carton', 6, 3],
  ['ENRG', 'مشروب طاقة', 'Energy drink 250ml', 800, 4, 'Tray', 24, 3],
  ['SODA', 'مياه غازية', 'Soda water 330ml', 275, 4, 'Tray', 24, 1],
  ['DETG', 'مسحوق غسيل ٢.٥ كجم', 'Washing powder 2.5kg', 3450, 5, 'Carton', 6, 2],
  ['DISH', 'سائل جلي ١ لتر', 'Dish soap 1L', 1050, 5, 'Carton', 12, 3],
  ['TISS', 'مناديل ٢٠٠ ورقة', 'Tissues 200 sheets', 450, 5, 'Carton', 20, 4],
  ['BLCH', 'مبيض ٢ لتر', 'Bleach 2L', 875, 5, 'Carton', 6, 2],
  ['SOAP', 'صابون ١٢٠ جم', 'Soap bar 120g', 400, 5, 'Carton', 48, 3],
  ['SHMP', 'شامبو ٤٠٠ مل', 'Shampoo 400ml', 1800, 5, 'Carton', 12, 2],
  ['TPLR', 'ورق حمام ١٠ لفات', 'Toilet rolls 10 pack', 1650, 5, 'Bale', 6, 3],
  ['GRBG', 'أكياس نفايات ٣٠ كيس', 'Bin bags 30 pack', 925, 5, 'Carton', 24, 2],
  ['FOIL', 'ورق ألمنيوم ٣٠ قدم', 'Foil roll 30ft', 1250, 5, 'Carton', 12, 1],
];
const KILOS: Row[] = [
  ['APL', 'تفاح أحمر', 'Red apples', 799, 2, 'Crate', 18, 4],
  ['BAN', 'موز', 'Bananas', 599, 2, 'Box', 13, 5],
  ['TOM', 'طماطم', 'Tomatoes', 450, 2, 'Crate', 15, 5],
  ['CUC', 'خيار', 'Cucumbers', 550, 2, 'Crate', 10, 4],
  ['ONI', 'بصل', 'Onions', 325, 2, 'Sack', 20, 4],
  ['POT', 'بطاطس', 'Potatoes', 375, 2, 'Sack', 20, 5],
  ['ORG', 'برتقال', 'Oranges', 625, 2, 'Crate', 15, 3],
  ['LEM', 'ليمون', 'Lemons', 850, 2, 'Crate', 10, 2],
  ['CAR', 'جزر', 'Carrots', 495, 2, 'Sack', 10, 2],
  ['GRP', 'عنب', 'Grapes', 1450, 2, 'Crate', 8, 2],
];

const CUSTOMERS = [
  'Abdullah Al-Harbi', 'Amal Bakr', 'Bandar Al-Otaibi', 'Basma Noor', 'Corner Cafe', 'Dalal Hamdan', 'Eman Saleh', 'Fahad Mini Mart', 'Ghada Yousef', 'Hani Qasim',
  'Hessa Mansour', 'Ibrahim Shaker', 'Jamila Kareem', 'Khalid Rest House', 'Layla Fawzi', 'Mansour Tailoring', 'Maha Rashid', 'Nawaf Al-Dosari', 'Noura Hassan', 'Office Tea Club',
  'Qais Barakat', 'Rana Sami', 'Salem Workshop', 'Tala Ibrahim', 'Waleed Nasser', 'Zainab Omar',
];

interface Product {
  id: number;
  price: number;
  weighed: boolean;
  supplier: number;
  pack: string;
  size: number;
  sells: number;
  sku: string;
  restock: boolean;
}

interface Sold {
  invoiceNo: string;
  qty: number;
  weighed: boolean;
}

export function seedDemoShop(base: Ctx, nowIso: string, options: { days?: number } = {}): DemoSummary {
  const history = options.days ?? 12;
  const nowMs = Date.parse(nowIso);
  let clock = nowMs;
  const ctx: Ctx = { ...base, now: () => new Date(clock).toISOString() };
  const today = storeDay(nowIso);
  const dayOf = (k: number) => new Date(Date.parse(`${today}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
  const at = (k: number, time: string) => {
    clock = Math.min(Date.parse(`${dayOf(k)}T${time}:00+03:00`), nowMs);
  };

  let serial = 0;
  const key = (what: string) => `demo-${what}-${++serial}`;
  let seed = 20261108;
  const rand = (n: number) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let z = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) % n;
  };

  at(-history - 2, '09:00');
  const owner = createUser(ctx, null, DEMO_LOGINS[0]!);
  const supervisor = createUser(ctx, owner, DEMO_LOGINS[1]!);
  const cashiers = [createUser(ctx, owner, DEMO_LOGINS[2]!), createUser(ctx, owner, DEMO_LOGINS[3]!)];

  saveStoreDetails(ctx, owner, {
    nameAr: 'سوبرماركت تجريبي', nameEn: 'Demo Supermarket', legalNameAr: 'شركة المتجر التجريبي', legalNameEn: 'Demo Store Company', vatNumber: '300000000000003', crNumber: '0000000000',
    mobile: '0500000000', buildingNo: '0000', street: 'Demo Street', district: 'Demo District', city: 'Demo City', postalCode: '00000', additionalNo: '0000', addressLine: 'Demo Street, Demo City', logo: '', footerAr: 'بيانات تجريبية', footerEn: 'Demo data only',
  });
  ctx.db.prepare("INSERT INTO scale_barcode_formats (prefix, item_digits, value_digits, embedded) VALUES ('21', 5, 5, 'weight'), ('22', 5, 5, 'price')").run();
  // The owner's money that started the shop, so the bank does not show as overdrawn.
  postEntry(ctx, { date: dayOf(-history - 2), sourceType: 'demo_opening', sourceId: 1, memo: 'Owner money put in (demo)', lines: [{ account: '1030', debit: 15_000_000 }, { account: '3000', credit: 15_000_000 }] });

  const suppliers = SUPPLIERS.map((s, i) => ({ ...s, vat: `3000000000001${i}3`, id: createSupplier(ctx, owner, { name: s.name, phone: `05590001${i}0`, vatNumber: `3000000000001${i}3`, paymentTermsDays: s.terms }) }));
  const products: Product[] = [...PIECES.map((r) => [r, false] as const), ...KILOS.map((r) => [r, true] as const)].map(([r, weighed], i) => {
    const [sku, nameAr, nameEn, price, supplier, pack, size, sells] = r;
    const twelve = `628${String(5000 + i).padStart(9, '0')}`;
    const id = createProduct(ctx, owner, {
      sku, nameAr, nameEn, unitCode: weighed ? 'KG' : 'PCS', sellMode: weighed ? 'weight' : 'unit', vatRateBp: 1500, priceIncl: price, reorderLevel: (size + sells) * MILLI_PER_UNIT,
      ...(weighed ? { plu: String(200 + i) } : { barcodes: [twelve + ean13CheckDigit(twelve)] }),
    });
    return { id, price, weighed, supplier, pack, size, sells, sku, restock: (i + 1) % 9 !== 0 };
  });
  const stock = (id: number) => (ctx.db.prepare('SELECT qty FROM stock_balances WHERE product_id = ?').get(id) as { qty: number } | undefined)?.qty ?? 0;
  const packPrice = (p: Product) => roundDiv(p.price * p.size * 65, 100);

  const customerIds = CUSTOMERS.map((name, i) => createCustomer(ctx, owner, { name, phone: `05580${String(10_000 + i * 37)}` }));
  const creditIds = customerIds.filter((_, i) => i % 3 === 0);
  creditIds.forEach((customerId, i) => updateCustomerCredit(ctx, owner, { customerId, creditEnabled: true, creditLimit: i % 4 === 3 ? null : 150_000 + i * 50_000, paymentTermsDays: [7, 14, 30, null][i % 4]! }));

  // ---- Supplier papers ----
  let docNo = 4100;
  const billIds: { billId: number; supplier: number; net: number; vat: number }[] = [];
  const bill = (supplier: number, k: number, wanted: [Product, number][], o: { docType?: DocType; paid?: 'till' | 'bank'; part?: number } = {}) => {
    const s = suppliers[supplier]!;
    const docType = o.docType ?? 'tax_invoice';
    const lines: SupplierBillLine[] = wanted.map(([p, packs]) => ({ productId: p.id, supplierCode: `${supplier + 1}${p.sku}`, packName: p.pack, pageNo: 1, unitsPerPack: p.size * MILLI_PER_UNIT, packs, looseQty: 0, freeQty: 0, priceBasis: 'pack', price: packPrice(p), vatRateBp: 1500 }));
    const b = computeBill(lines, 0, 0);
    const r = createSupplierBill(ctx, owner, {
      requestKey: key('bill'), supplierId: s.id, docType, docNo: `${docType === 'delivery_note' ? 'DN' : docType === 'proforma' ? 'PF' : 'TI'}-${++docNo}`, docDate: dayOf(k), salesAgent: s.agent,
      payType: o.paid ? 'paid' : 'credit', payMethod: o.paid, paidNow: o.part, pages: 1, billDiscount: 0, billCharge: 0, paper: { gross: b.gross, discount: b.discount, net: b.net, vat: b.vat, total: b.total },
      supplierVatNo: docType === 'tax_invoice' ? s.vat : undefined, notSameGoods: true, lines,
    });
    billIds.push({ billId: r.billId, supplier, net: b.net, vat: b.vat });
    return r;
  };
  const packsTo = (p: Product, units: number) => {
    const need = units * MILLI_PER_UNIT - stock(p.id);
    return need <= 0 ? 0 : Math.trunc(need / (p.size * MILLI_PER_UNIT)) + 1;
  };
  const restock = (supplier: number, k: number, o: { docType?: DocType; paid?: 'till' | 'bank' } = {}) => {
    const wanted = products.filter((p) => p.supplier === supplier && p.restock && stock(p.id) < 8 * p.sells * MILLI_PER_UNIT).map((p) => [p, packsTo(p, 16 * p.sells)] as [Product, number]);
    return wanted.length ? bill(supplier, k, wanted, o) : null;
  };

  at(-history - 1, '10:00');
  setSupplierOpeningBalance(ctx, owner, { supplierId: suppliers[5]!.id, amount: 420_000, asOf: dayOf(-history - 1), reference: 'Balance from old books' });
  suppliers.forEach((_, i) => {
    bill(i, -history - 1, products.filter((p) => p.supplier === i).map((p) => [p, packsTo(p, (p.restock ? 18 : 6) * p.sells)]), i === 2 || i === 3 ? { paid: 'bank' } : {});
  });

  // ---- Expenses ----
  const cats = Object.fromEntries(listCategories(ctx, owner).map((c) => [c.nameEn, c.id]));
  const expense = (k: number, category: string, description: string, gross: number, o: { vat?: boolean; pay?: 'bank' | 'till'; draft?: boolean; due?: number; payee?: string; period?: [string, string] } = {}) => {
    const vatClass: VatClass = o.vat ? 'standard' : 'out_of_scope';
    const id = createExpense(ctx, owner, {
      requestKey: key('expense'), categoryId: cats[category]!, description, payee: o.payee, expenseDate: dayOf(k), dueDate: o.due === undefined ? undefined : dayOf(o.due), gross, vatClass, vatAmount: o.vat ? roundDiv(gross * 15, 115) : 0, vatRecoverable: !!o.vat,
      invoiceRef: o.vat ? `EX-${7000 + serial}` : undefined, supplierVatNo: o.vat ? '300000000000203' : undefined, periodStart: o.period?.[0], periodEnd: o.period?.[1],
    });
    if (!o.draft) postExpense(ctx, owner, id, o.pay ? { requestKey: key('expense-pay'), method: o.pay } : undefined);
    return id;
  };

  saveRecurring(ctx, owner, { name: 'Shop rent', categoryId: cats.Rent!, expectedGross: 600_000, variableAmount: false, interval: 'monthly', startDate: dayOf(-history), dueDay: 5, payee: 'Demo Landlord', vatClass: 'out_of_scope', vatRecoverable: false, active: true });
  saveRecurring(ctx, owner, { name: 'Internet line', categoryId: cats.Internet!, expectedGross: 34_500, variableAmount: false, interval: 'monthly', startDate: dayOf(-history), dueDay: 20, payee: 'Demo Telecom', vatClass: 'standard', vatRecoverable: true, active: true });
  at(-history, '07:45');
  generateRecurring(ctx, owner);

  const creditTotals = () => creditIds.flatMap((id) => openInvoicesOf(ctx, id).map((i) => ({ customerId: id, saleId: i.saleId, open: i.open })));

  // ---- The days ----
  let sales = 0;
  const shortAndOver = [0, 0, -350, 0, 150, 0, 0, -1200, 0, 250, 0, -75];
  let earlier: Sold[] = [];
  for (let k = -history; k <= 0; k++) {
    const isToday = k === 0;
    if (!isToday) {
      at(k, '07:30');
      // Fresh goods come often; the rest once or twice in the period.
      if ((k & 1) === 0) restock(0, k);
      if ((k & 1) === 0) restock(2, k, { paid: 'bank' });
      if (k === -8 || k === -3) restock(1, k);
      if (k === -7) restock(4, k);
      if (k === -6) restock(5, k);
      if (k === -5) {
        const dn = bill(1, k, products.filter((p) => p.supplier === 1 && p.restock).slice(0, 5).map((p) => [p, 2]), { docType: 'delivery_note' });
        const row = billIds.at(-1)!;
        at(-3, '07:40');
        const grn = ctx.db.prepare('SELECT grn_id AS id FROM supplier_bills WHERE id = ?').get(dn.billId) as { id: number };
        createPurchaseInvoice(ctx, owner, { requestKey: key('pinv'), supplierId: suppliers[1]!.id, supplierInvoiceNo: `TI-${++docNo}`, supplierVatNo: suppliers[1]!.vat, invoiceDate: dayOf(-3), grnIds: [grn.id], invoiceNet: row.net, vatAmount: row.vat, vatRecoverable: true });
        at(k, '07:45');
      }
      if (k === -2) bill(4, k, products.filter((p) => p.supplier === 4 && p.restock).slice(0, 4).map((p) => [p, 3]), { docType: 'delivery_note' });
      if (k === -1) bill(5, k, products.filter((p) => p.supplier === 5 && p.restock).slice(0, 3).map((p) => [p, 2]), { docType: 'proforma', paid: 'bank' });
    }

    const windowStart = isToday ? Math.max(nowMs - 3 * 3_600_000, Date.parse(`${today}T00:01:00+03:00`)) : Date.parse(`${dayOf(k)}T08:00:00+03:00`);
    const windowEnd = isToday ? nowMs : Date.parse(`${dayOf(k)}T22:30:00+03:00`);
    const slot = (share: number, of: number) => {
      clock = Math.min(windowStart + Math.trunc(((windowEnd - windowStart) * share) / of), nowMs);
    };
    slot(0, 1);
    const cashier = cashiers[(k + history) % 2]!;
    const shift = openShift(ctx, cashier, 50_000);
    const weekday = new Date(`${dayOf(k)}T00:00:00Z`).getUTCDay();
    const count = isToday ? 18 : 40 + rand(14) + (weekday === 4 || weekday === 5 ? 8 : 0); // busier Thursday and Friday
    const todays: Sold[] = [];

    const basket = () => {
      const wanted = 1 + rand(6);
      const seen = new Set<number>();
      const list: { p: Product; qty: number; discount?: number }[] = [];
      for (let tries = 0; list.length < wanted && tries < 25; tries++) {
        const p = products[rand(products.length)]!;
        if (seen.has(p.id) || rand(5) >= p.sells) continue;
        const qty = p.weighed ? 250 * (2 + rand(10)) : MILLI_PER_UNIT * (1 + rand(3));
        if (stock(p.id) < qty) continue;
        seen.add(p.id);
        list.push({ p, qty });
      }
      return list;
    };

    const sellOne = () => {
      const list = basket();
      if (list.length === 0) return;
      const discounted = rand(20) === 0;
      if (discounted) list[0]!.discount = roundDiv(roundDiv(list[0]!.p.price * list[0]!.qty, MILLI_PER_UNIT) * 10, 100);
      const total = computeInvoice(list.map((l) => ({ unitPriceIncl: l.p.price, qty: l.qty, discount: l.discount ?? 0, vatRate: 1500 }))).totalIncl;
      const roll = rand(100);
      let payments: PaymentInput[];
      let customerId: number | undefined;
      const creditCustomer = creditIds[rand(creditIds.length)]!;
      const room = creditCheck(ctx, creditCustomer, 0).available;
      if (roll >= 88 && (room === null || room >= total)) {
        customerId = creditCustomer;
        const part = roll >= 95 && total > 1000 ? roundDiv(total, 2) : 0;
        payments = [...(part ? [{ tender: 'cash' as const, amount: part }] : []), { tender: 'account' as const, amount: total - part }];
      } else if (roll >= 80) {
        const card = roundDiv(total, 2);
        payments = [{ tender: 'card', amount: card, reference: `A${100_000 + serial}` }, { tender: 'cash', amount: total - card }];
      } else if (roll >= 43) {
        payments = [{ tender: 'card', amount: total, reference: `A${100_000 + serial}` }];
      } else {
        payments = [{ tender: 'cash', amount: total + ((500 - (total % 500)) % 500) }];
      }
      if (customerId === undefined && rand(6) === 0) customerId = customerIds[rand(customerIds.length)];
      const r = finalizeSale(ctx, cashier, { idempotencyKey: key('sale'), lines: list.map((l) => ({ productId: l.p.id, qty: l.qty, discount: l.discount })), payments, customerId, discountApproverId: discounted ? supervisor : undefined });
      sales++;
      if (!payments.some((p) => p.tender === 'account')) todays.push({ invoiceNo: r.invoiceNo, qty: list[0]!.qty, weighed: list[0]!.p.weighed });
    };

    const refund = (from: Sold[]) => {
      const s = from[rand(from.length)];
      if (!s) return;
      const reasons = ['Customer changed mind', 'Damaged or faulty', 'Expired', 'Wrong item'];
      const reason = reasons[rand(reasons.length)]!;
      createRefund(ctx, supervisor, { requestKey: key('refund'), invoiceNo: s.invoiceNo, reason, lines: [{ saleLineNo: 1, qty: s.qty, restock: reason === 'Customer changed mind' || reason === 'Wrong item' }] });
      from.splice(from.indexOf(s), 1);
    };

    for (let i = 0; i < count; i++) {
      slot(i + 1, count + 6);
      sellOne();
      // Things that happen during the day.
      if (i === Math.trunc(count / 3)) {
        const p = products[rand(products.length)]!;
        recordRemoval(ctx, cashier, 'line_removed', key('removed'), [{ productId: p.id, qty: p.weighed ? 750 : MILLI_PER_UNIT, amount: p.weighed ? roundDiv(p.price * 750, MILLI_PER_UNIT) : p.price }]);
        if (rand(3) === 0) {
          const q = products[rand(products.length)]!;
          recordRemoval(ctx, cashier, 'bill_cleared', key('cleared'), [{ productId: q.id, qty: q.weighed ? 500 : MILLI_PER_UNIT, amount: q.weighed ? roundDiv(q.price, 2) : q.price }]);
        }
      }
      if (i === Math.trunc(count / 2)) {
        refund(todays);
        if (k % 3 === 0 && !isToday) refund(earlier);
        if ((k & 1) !== 0 && !isToday) restock(3, k, { paid: 'till' });
        if (k % 4 === 0 || isToday) recordCashMovement(ctx, supervisor, 'out', 30_000 + rand(4) * 5000, isToday ? 'Small change from the shop next door' : 'Bought small change');
        if (k % 5 === 0 && !isToday) recordCashMovement(ctx, supervisor, 'in', 20_000, 'Float top-up from the safe');
      }
      if (i === Math.trunc((count * 2) / 3)) {
        const open = creditTotals();
        const pick = open[rand(open.length)];
        if (pick && (k & 1) === 0) {
          const whole = rand(2) === 0;
          const amount = whole ? pick.open : Math.max(1, roundDiv(pick.open, 2));
          recordCustomerReceipt(ctx, supervisor, { requestKey: key('receipt'), customerId: pick.customerId, amount, method: (['cash', 'card', 'bank'] as const)[rand(3)]!, allocations: [{ saleId: pick.saleId, amount }] });
        }
      }
    }

    // Day-specific events.
    slot(count + 2, count + 6);
    if (k === -9 || k === -4 || isToday) {
      const list = products.filter((p) => stock(p.id) > 3 * MILLI_PER_UNIT).slice(k === -9 ? 0 : k === -4 ? 12 : 30, k === -9 ? 2 : k === -4 ? 15 : 32);
      recordWastage(ctx, supervisor, { requestKey: key('waste'), reason: isToday ? 'Damaged on the shelf' : 'Expired', lines: list.map((p) => ({ productId: p.id, qty: p.weighed ? 1500 : MILLI_PER_UNIT })) });
    }
    if (k === -5) {
      const list = products.filter((p) => !p.weighed && stock(p.id) > 5 * MILLI_PER_UNIT).slice(20, 26);
      postStockCount(ctx, supervisor, { requestKey: key('count'), reason: 'Shelf count, aisle 3', lines: list.map((p, i) => ({ productId: p.id, countedQty: stock(p.id) + (i % 3 === 0 ? -MILLI_PER_UNIT : i % 3 === 1 ? MILLI_PER_UNIT : 0) })) });
    }
    if (k === -6) {
      setPrice(ctx, owner, products[0]!.id, 675);
      products[0]!.price = 675;
      setPrice(ctx, owner, products[8]!.id, 925);
      products[8]!.price = 925;
    }
    if (k === -7) paySupplier(ctx, owner, { requestKey: key('pay'), supplierId: suppliers[0]!.id, amount: 180_000, method: 'bank', paidOn: dayOf(k), reference: 'TRF-3301' });
    if (k === -3) {
      paySupplier(ctx, owner, { requestKey: key('pay'), supplierId: suppliers[1]!.id, amount: 350_000, method: 'bank', paidOn: dayOf(k), reference: 'TRF-3302' });
      paySupplier(ctx, owner, { requestKey: key('pay'), supplierId: suppliers[4]!.id, amount: 45_000, method: 'till', paidOn: dayOf(k) });
    }
    if (k === -4) {
      const p = products.find((x) => x.sku === 'MLK1')!;
      const net = roundDiv(packPrice(p), p.size) * 2;
      createPurchaseReturn(ctx, owner, { requestKey: key('return'), supplierId: suppliers[0]!.id, supplierCreditRef: 'CN-908', returnDate: dayOf(k), reason: 'Short dated milk', lines: [{ productId: p.id, qty: 2 * MILLI_PER_UNIT }], creditNet: net, vatAmount: roundDiv(net * 15, 100), vatRecoverable: true });
    }
    if (k === -10) expense(k, 'Rent', 'Shop rent this month', 600_000, { pay: 'bank', payee: 'Demo Landlord' });
    if (k === -9) expense(k, 'Salaries', 'Staff wages', 1_250_000, { pay: 'bank', payee: 'Staff' });
    if (k === -8) expense(k, 'Electricity', 'Electricity bill', 87_345, { vat: true, due: 6, payee: 'Demo Power Co' });
    if (k === -7) expense(k, 'Water', 'Water bill', 12_650, { vat: true, due: -1, payee: 'Demo Water Co' });
    if (k === -6) expense(k, 'Cleaning', 'Floor cleaning supplies', 8_500, { pay: 'till' });
    if (k === -5) expense(k, 'Maintenance and repairs', 'Fridge repair', 46_000, { vat: true, pay: 'bank', payee: 'Cool Fix Services' });
    if (k === -4) expense(k, 'Transport', 'Delivery van fuel', 15_000, { pay: 'till' });
    if (k === -3) expense(k, 'Packaging', 'Carrier bags', 23_000, { vat: true, due: 12, payee: 'Pack Plus' });
    if (k === -2) {
      expense(k, 'Equipment purchase (capital)', 'New shelf unit', 345_000, { vat: true, pay: 'bank', payee: 'Shelf Makers' });
      reverseExpense(ctx, owner, expense(k, 'Security', 'Entered twice by mistake', 9_000), 'Entered twice');
    }
    if (k === -1) {
      expense(k, 'Bank charges', 'Card machine fees', 21_275, { vat: true, pay: 'bank', payee: 'Demo Bank' });
      expense(k, 'Software subscriptions', 'Yearly accounting software', 120_000, { vat: true, pay: 'bank', payee: 'Demo Software', period: [dayOf(k).slice(0, 7), dayOf(k + 330).slice(0, 7)] });
      const due = prepaidPreview(ctx, owner, dayOf(k).slice(0, 7));
      recognizePrepaidMonth(ctx, owner, { month: due.throughMonth, requestKey: key('prepaid'), expectedTotal: due.total });
      expense(k, 'Other operating expenses', 'Waiting for the receipt', 18_000, { draft: true });
      const open = creditTotals();
      const a = open[0];
      const b = open[1];
      const c = open[2];
      if (a) setInvoiceDispute(ctx, owner, a.saleId, true, 'Customer says one item was not delivered');
      if (b) writeOffInvoice(ctx, owner, { requestKey: key('writeoff'), saleId: b.saleId, amount: Math.min(b.open, 500), reason: 'Small balance forgiven' });
      if (c) {
        const amount = Math.max(1, roundDiv(c.open, 2));
        const r = recordCustomerReceipt(ctx, supervisor, { requestKey: key('receipt'), customerId: c.customerId, amount, method: 'cash', allocations: [{ saleId: c.saleId, amount }] });
        reverseCustomerReceipt(ctx, owner, r.receiptId, key('reverse'), 'Cheque returned');
      }
      recordCustomerReceipt(ctx, supervisor, { requestKey: key('receipt'), customerId: creditIds[2]!, amount: 25_000, method: 'cash', notes: 'Paid in advance', allocations: [] });
    }
    if (isToday) expense(0, 'Cleaning', 'Glass cleaner', 3_500, { pay: 'till' });

    // Held bills: one comes back, and today's stay on hold.
    const held = (label: string) => {
      const list = basket();
      return list.length ? holdBill(ctx, cashier, label, { lines: list.map((l) => ({ productId: l.p.id, qty: l.qty })), billKey: key('held') }) : null;
    };
    if (k % 2 === 0 && !isToday) {
      const id = held('Back in five minutes');
      if (id) recallBill(ctx, cashier, id);
    }
    if (isToday) {
      held('Lady in blue');
      held('Forgot wallet');
      held('Driver pick up');
    }

    if (!isToday) {
      at(k, '23:00');
      closeShift(ctx, k % 2 === 0 ? cashier : supervisor, Math.max(0, shiftSummary(ctx, shift).expectedCash + shortAndOver[(k + history) % shortAndOver.length]!));
    }
    earlier = [...earlier.slice(-40), ...todays];
  }

  clock = nowMs;
  setProductActive(ctx, owner, products.find((p) => p.sku === 'FOIL')!.id, false, 'No longer stocked');
  setProductActive(ctx, owner, products.find((p) => p.sku === 'SODA')!.id, false, 'Supplier stopped it');
  listHeldBills(ctx);
  return { owner, days: history + 1, sales };
}
