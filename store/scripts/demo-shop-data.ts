// Made-up shop data for local testing only. No real product, price or store detail belongs here.
import type { Db } from '../../dashboard/src/server/db-types.ts';

const CATEGORIES = ['Fruits', 'Vegetables', 'Meat & poultry', 'Seafood', 'Dairy & eggs', 'Bakery', 'Pantry', 'Beverages', 'Snacks'];

type Row = [name: string, category: number, price: number, image: string | null, onHandUnits: number, options?: { weight?: boolean; featured?: boolean; status?: string; vat?: number }];

const ITEMS: Row[] = [
  ['Red apples', 1, 899, 'apple', 40, { weight: true, featured: true }],
  ['Bananas', 1, 650, 'banana', 35, { weight: true, featured: true }],
  ['Sweet oranges', 1, 750, 'orange', 3, { weight: true }],
  ['Vine tomatoes', 2, 575, 'tomato', 50, { weight: true, featured: true }],
  ['Carrots', 2, 425, 'carrot', 30, { weight: true }],
  ['Green lettuce', 2, 395, 'lettuce', 12, { featured: true }],
  ['Potatoes', 2, 350, 'potato', 80, { weight: true }],
  ['Chicken drumsticks', 3, 2250, 'chicken', 20, { weight: true }],
  ['Beef steak', 3, 5900, 'meat', 8, { weight: true, featured: true }],
  ['Whole sea bream', 4, 3800, 'fish', 0, { weight: true }],
  ['Fresh milk 1 L', 5, 700, 'milk', 60, { featured: true }],
  ['Farm eggs, 12 pack', 5, 1450, 'eggs', 25],
  ['Mild cheddar 200 g', 5, 1695, 'cheese', 4],
  ['Sliced white bread', 6, 550, 'bread', 18],
  ['Butter croissant', 6, 450, 'croissant', 22, { featured: true }],
  ['Long grain rice 5 kg', 7, 3995, 'rice', 40],
  ['Olive oil 750 ml', 7, 3450, 'oil', 15],
  ['Orange juice 1 L', 8, 950, 'juice', 30],
  ['Still water 1.5 L', 8, 200, 'water', 200],
  ['Salted potato chips', 9, 625, 'chips', 45],
  ['Choc chip cookies', 9, 899, 'cookie', 28],
  ['Product with no photo yet', 7, 1200, null, 10],
  ['Hidden draft item', 7, 999, null, 5, { status: 'unpublished' }],
  ['Archived old item', 7, 999, null, 5, { status: 'archived' }],
];

export async function seedDemoShop(owner: Db): Promise<void> {
  const statements = [];
  CATEGORIES.forEach((name, i) => {
    statements.push({ text: "INSERT INTO commerce.catalog_categories (pos_category_id, name_en, name_ar) VALUES ($1, $2, '')", params: [i + 1, name] });
    statements.push({ text: 'INSERT INTO commerce.web_categories (pos_category_id, sort) VALUES ($1, $2)', params: [i + 1, i] });
  });
  ITEMS.forEach(([name, category, price, image, onHand, o = {}], i) => {
    const id = i + 1;
    statements.push({ text: `INSERT INTO commerce.catalog_products (pos_product_id, sku, name_en, name_ar, category_id, unit, sell_mode, price_incl, vat_rate_bp, pos_active) VALUES ($1, $2, $3, '', $4, $5, $6, $7, $8, true)`, params: [id, `DEMO-${String(id).padStart(3, '0')}`, name, category, o.weight ? 'kg' : 'piece', o.weight ? 'weight' : 'unit', price, o.vat ?? 1500] });
    statements.push({ text: 'INSERT INTO commerce.web_products (pos_product_id, description, status, featured) VALUES ($1, $2, $3, $4)', params: [id, `${name}. Sample description for local testing.`, o.status ?? 'published', o.featured ?? false] });
    statements.push({ text: 'INSERT INTO commerce.inventory_positions (pos_product_id, on_hand) VALUES ($1, $2)', params: [id, onHand * 1000] });
    if (image) statements.push({ text: 'INSERT INTO commerce.product_images (pos_product_id, object_key, width, height, size_bytes, is_primary) VALUES ($1, $2, 200, 200, 1000, true)', params: [id, `demo/${image}.svg`] });
  });
  statements.push({ text: "INSERT INTO commerce.delivery_areas (name) VALUES ('Made-up North'), ('Made-up Central')" });
  statements.push({ text: 'UPDATE commerce.store_settings SET delivery_fee_incl = 1500' });
  statements.push({ text: "INSERT INTO commerce.devices (name, secret_hash, last_seen_at) VALUES ('Simulated till', 'not-a-real-credential', now())" });
  await owner.batch(statements);
  const [mix] = await owner.query<{ id: string }>("INSERT INTO commerce.product_images (object_key, width, height, size_bytes) VALUES ('demo/mix.svg', 340, 260, 1000) RETURNING id");
  await owner.query("INSERT INTO commerce.banners (title, body, image_id, link, active) VALUES ('This week''s fresh picks', 'Hand-picked fruit and vegetables.', $1, '/categories/1', true)", [mix!.id]);
}
