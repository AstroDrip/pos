// Fake demo data for visual QA and the UI audit. Writes ONLY to the database path it is given (a temporary folder).
// Never point it at the store's database. All names, phones and VAT numbers are fictional.
import { createRequire } from 'node:module';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const dist = (p) => require(join(root, 'dist', 'main', p));

export function seed(dbPath) {
  const { openDatabase } = dist('db/connection.js');
  const { makeCtx } = dist('services/context.js');
  const { createUser } = dist('services/users.js');
  const { createProduct } = dist('services/catalog.js');
  const { createSupplier, createCustomer } = dist('services/parties.js');
  const { receiveGoods } = dist('services/inventory.js');
  const { openShift } = dist('services/shifts.js');
  const { finalizeSale } = dist('services/sales.js');
  const { createRefund } = dist('services/refunds.js');
  const { updateCustomerCredit, recordCustomerReceipt } = dist('services/credit.js');
  const { createExpense, postExpense, listCategories } = dist('services/expenses.js');
  const { createPurchaseInvoice, paySupplier } = dist('services/purchasing.js');
  const { recordWastage } = dist('services/adjustments.js');
  const ctx = makeCtx(openDatabase(dbPath));
  const owner = createUser(ctx, null, { username: 'owner', displayName: 'Owner', pin: '4321', roles: ['admin'] });
  const sup = createUser(ctx, owner, { username: 'sup', displayName: 'Supervisor', pin: '2222', roles: ['supervisor'] });
  const cashier = createUser(ctx, owner, { username: 'cashier', displayName: 'Cashier One', pin: '1111', roles: ['cashier'] });
  const set = ctx.db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  set.run('سوبرماركت تجريبي', 'store_name_ar');
  set.run('Demo Supermarket', 'store_name_en');
  const names = [
    ['WAT15', 'ماء ١.٥ لتر', 'Water 1.5L', 250, 150], ['MLK1', 'حليب طازج ١ لتر', 'Fresh milk 1L', 650, 480], ['BRD', 'خبز عربي', 'Arabic bread', 100, 60],
    ['RICE5', 'أرز بسمتي ٥ كجم', 'Basmati rice 5kg', 3200, 2500], ['OIL', 'زيت دوار الشمس ١.٨ لتر', 'Sunflower oil 1.8L', 1895, 1400], ['SUG', 'سكر ٢ كجم', 'Sugar 2kg', 950, 700],
    ['TEA', 'شاي أحمر ١٠٠ كيس', 'Black tea 100 bags', 1450, 1000], ['DAT', 'تمر سكري ١ كجم', 'Sukkari dates 1kg', 3500, 2400],
  ];
  const ids = names.map(([sku, ar, en, price, cost], i) => [createProduct(ctx, owner, { sku, nameAr: ar, nameEn: en, unitCode: 'PCS', sellMode: 'unit', vatRateBp: 1500, priceIncl: price, barcodes: [`62810000000${i}${i}`] }), cost]);
  const farm = createSupplier(ctx, owner, { name: 'Al Marai Distribution', vatNumber: '300000000000003', paymentTermsDays: 30 });
  const local = createSupplier(ctx, owner, { name: 'Jeddah Wholesale', paymentTermsDays: 0 });
  const g = receiveGoods(ctx, owner, { supplierId: farm, reference: 'DN-2231', lines: ids.map(([id, cost]) => ({ productId: id, qty: 40_000, unitCost: cost })) });
  receiveGoods(ctx, owner, { supplierId: local, reference: 'JW-88', lines: [{ productId: ids[2][0], qty: 100_000, unitCost: 55 }] });
  const total = ids.reduce((s, [, c]) => s + 40 * c, 0);
  const pi = createPurchaseInvoice(ctx, owner, { requestKey: 'seed-pi-0001', supplierId: farm, supplierInvoiceNo: 'AM-55012', supplierVatNo: '300000000000003', invoiceDate: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10), grnIds: [g.grnId], invoiceNet: total, vatAmount: Math.round(total * 0.15), vatRecoverable: true });
  paySupplier(ctx, owner, { requestKey: 'seed-sp-0001', supplierId: farm, amount: 50_000, method: 'bank', paidOn: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10), allocations: [{ invoiceId: pi.invoiceId, amount: 50_000 }] });
  const ahmed = createCustomer(ctx, owner, { name: 'Ahmed Al-Ghamdi', phone: '0551112222' });
  const sara = createCustomer(ctx, owner, { name: 'Sara Mini Market', phone: '0553334444' });
  updateCustomerCredit(ctx, owner, { customerId: ahmed, creditEnabled: true, creditLimit: 100_000, paymentTermsDays: 30 });
  updateCustomerCredit(ctx, owner, { customerId: sara, creditEnabled: true, creditLimit: null, paymentTermsDays: null });
  openShift(ctx, cashier, 20_000);
  let n = 0;
  const sale = (lines, payments, customerId) => finalizeSale(ctx, cashier, { idempotencyKey: `seed-sale-${++n}-x`, lines, payments, customerId });
  const s1 = sale([{ productId: ids[0][0], qty: 6000 }, { productId: ids[1][0], qty: 2000 }], [{ tender: 'cash', amount: 3_000 }]);
  sale([{ productId: ids[3][0], qty: 1000 }, { productId: ids[4][0], qty: 1000 }], [{ tender: 'card', amount: 5_095 }]);
  const c1 = sale([{ productId: ids[7][0], qty: 2000 }, { productId: ids[6][0], qty: 1000 }], [{ tender: 'cash', amount: 3_000 }, { tender: 'account', amount: 5_450 }], ahmed);
  sale([{ productId: ids[5][0], qty: 4000 }], [{ tender: 'account', amount: 3_800 }], sara);
  recordCustomerReceipt(ctx, cashier, { requestKey: 'seed-rc-0001', customerId: ahmed, amount: 2_000, method: 'cash', allocations: [{ saleId: c1.saleId, amount: 2_000 }] });
  createRefund(ctx, cashier, { requestKey: 'seed-rf-0001', invoiceNo: s1.invoiceNo, reason: 'Customer changed mind', lines: [{ saleLineNo: 1, qty: 1000, restock: true }], approverId: sup });
  recordWastage(ctx, owner, { requestKey: 'seed-ws-0001', reason: 'Expired', lines: [{ productId: ids[1][0], qty: 2000 }] });
  const cats = Object.fromEntries(listCategories(ctx, owner).map((c) => [c.nameEn, c.id]));
  const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  postExpense(ctx, owner, createExpense(ctx, owner, { requestKey: 'seed-ex-0001', categoryId: cats.Rent, description: 'Shop rent November', payee: 'Landlord', expenseDate: day, gross: 450_000, vatClass: 'out_of_scope', vatAmount: 0, vatRecoverable: false }), { requestKey: 'seed-ex-pay1', method: 'bank' });
  postExpense(ctx, owner, createExpense(ctx, owner, { requestKey: 'seed-ex-0002', categoryId: cats.Electricity, description: 'SEC electricity October', payee: 'Saudi Electricity Co.', expenseDate: day, dueDate: day, gross: 87_345, vatClass: 'standard', vatAmount: 11_393, vatRecoverable: true, invoiceRef: 'SEC-1029', supplierVatNo: '300000000000003' }));
  createExpense(ctx, owner, { requestKey: 'seed-ex-0003', categoryId: cats.Cleaning, description: 'Cleaning supplies', expenseDate: day, gross: 12_000, vatClass: 'out_of_scope', vatAmount: 0, vatRecoverable: false });
  ctx.db.pragma('wal_checkpoint(TRUNCATE)');
  ctx.db.close();
}
