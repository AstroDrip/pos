import type { Db } from '../../../dashboard/src/server/db-types.ts';
import { readEnv } from './env.ts';

// What customers can see. Only published, active, physical products ever leave this file.

export interface Availability {
  state: 'in_stock' | 'low' | 'out' | 'unknown';
  /** Milli-units free to order. Null means we cannot honestly say. */
  available: number | null;
}

export interface ShopProduct {
  id: number;
  sku: string;
  name: string;
  description: string;
  categoryId: number | null;
  categoryName: string | null;
  unit: string;
  sellMode: 'unit' | 'weight';
  priceIncl: number;
  featured: boolean;
  imageUrl: string | null;
  availability: Availability;
}

export interface ShopCategory {
  id: number;
  name: string;
  imageUrl: string | null;
  productCount: number;
}

export type ProductSort = 'recommended' | 'name' | 'price_asc' | 'price_desc';

export interface ProductQuery {
  categoryId?: number;
  q?: string;
  sort?: ProductSort;
  inStockOnly?: boolean;
  featuredOnly?: boolean;
  limit: number;
  offset?: number;
}

const LOW_STOCK = 5000;

export function availabilityOf(available: number | null, fresh: boolean): Availability {
  if (!fresh || available === null) return { state: 'unknown', available: null };
  if (available <= 0) return { state: 'out', available: 0 };
  return { state: available <= LOW_STOCK ? 'low' : 'in_stock', available };
}

const UNIT_WORDS: Record<string, string> = { PCS: 'piece', KG: 'kg', G: 'g', L: 'litre', ML: 'ml' };

/** The POS stores short unit codes. Shoppers see the word. */
export const unitLabel = (code: string): string => UNIT_WORDS[code.toUpperCase()] ?? code.toLowerCase();

export function imageUrl(objectKey: string | null): string | null {
  if (!objectKey) return null;
  if (objectKey.startsWith('demo/')) return `/${objectKey}`; // made-up local shop data only
  const base = readEnv().imageBaseUrl;
  return base ? `${base}/${objectKey}` : null;
}

export async function stockIsFresh(db: Db): Promise<boolean> {
  const [r] = await db.query<{ fresh: boolean }>(
    `SELECT COALESCE((SELECT max(last_seen_at) FROM commerce.devices WHERE status = 'active' AND NOT needs_checkpoint) > now() - make_interval(mins => s.stale_minutes), false) AS fresh
     FROM commerce.store_settings s WHERE s.id = 1`,
  );
  return r?.fresh === true;
}

export interface ProductRow {
  id: number | string;
  sku: string;
  name: string;
  description: string;
  category_id: number | string | null;
  category_name: string | null;
  unit: string;
  sell_mode: 'unit' | 'weight';
  price_incl: number;
  vat_rate_bp: number;
  featured: boolean;
  available: number | null;
  object_key: string | null;
  total: number | string;
}

export const SHOP_SELECT = `SELECT p.pos_product_id AS id, p.sku, p.name_en AS name, w.description, p.category_id, c.name_en AS category_name, p.unit, p.sell_mode, p.price_incl, p.vat_rate_bp, w.featured, a.available, i.object_key, count(*) OVER () AS total
  FROM commerce.catalog_products p
  JOIN commerce.web_products w ON w.pos_product_id = p.pos_product_id
  LEFT JOIN commerce.catalog_categories c ON c.pos_category_id = p.category_id
  LEFT JOIN commerce.product_availability a ON a.pos_product_id = p.pos_product_id
  LEFT JOIN commerce.product_images i ON i.pos_product_id = p.pos_product_id AND i.is_primary
  WHERE w.status = 'published' AND p.pos_active AND p.item_kind = 'stock'`;

export function toProduct(r: ProductRow, fresh: boolean): ShopProduct {
  return {
    id: Number(r.id),
    sku: r.sku,
    name: r.name,
    description: r.description,
    categoryId: r.category_id === null ? null : Number(r.category_id),
    categoryName: r.category_name,
    unit: unitLabel(r.unit),
    sellMode: r.sell_mode,
    priceIncl: r.price_incl,
    featured: r.featured,
    imageUrl: imageUrl(r.object_key),
    availability: availabilityOf(r.available, fresh),
  };
}

const ORDER: Record<ProductSort, string> = {
  recommended: 'w.featured DESC, p.name_en',
  name: 'p.name_en',
  price_asc: 'p.price_incl, p.name_en',
  price_desc: 'p.price_incl DESC, p.name_en',
};

const likeText = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

export async function listProducts(db: Db, query: ProductQuery): Promise<{ items: ShopProduct[]; total: number; stockFresh: boolean }> {
  const fresh = await stockIsFresh(db);
  const text = query.q?.trim();
  const rows = await db.query<ProductRow>(
    `${SHOP_SELECT}
     AND ($1::bigint IS NULL OR p.category_id = $1)
     AND ($2::text IS NULL OR p.name_en ILIKE $2 OR p.sku ILIKE $2 OR c.name_en ILIKE $2 OR EXISTS (SELECT 1 FROM commerce.catalog_barcodes b WHERE b.pos_product_id = p.pos_product_id AND b.barcode ILIKE $2))
     AND (NOT $3::boolean OR COALESCE(a.available, 0) > 0)
     AND (NOT $4::boolean OR w.featured)
     ORDER BY ${ORDER[query.sort ?? 'recommended']}
     LIMIT $5 OFFSET $6`,
    [query.categoryId ?? null, text ? likeText(text) : null, Boolean(query.inStockOnly && fresh), Boolean(query.featuredOnly), query.limit, query.offset ?? 0],
  );
  return { items: rows.map((r) => toProduct(r, fresh)), total: Number(rows[0]?.total ?? 0), stockFresh: fresh };
}

export async function getProduct(db: Db, id: number): Promise<ShopProduct | null> {
  const [row, fresh] = await Promise.all([db.query<ProductRow>(`${SHOP_SELECT} AND p.pos_product_id = $1`, [id]), stockIsFresh(db)]);
  return row[0] ? toProduct(row[0], fresh) : null;
}

export async function suggest(db: Db, q: string): Promise<{ id: number; name: string; categoryName: string | null }[]> {
  if (q.trim().length < 2) return [];
  const { items } = await listProducts(db, { q, sort: 'name', limit: 6 });
  return items.map((p) => ({ id: p.id, name: p.name, categoryName: p.categoryName }));
}

export async function listCategories(db: Db): Promise<ShopCategory[]> {
  const rows = await db.query<{ id: number | string; name: string; object_key: string | null; product_count: number | string }>(
    `SELECT c.pos_category_id AS id, c.name_en AS name, count(*) AS product_count,
       COALESCE((SELECT i.object_key FROM commerce.product_images i WHERE i.id = wc.image_id),
                min(i.object_key)) AS object_key
     FROM commerce.catalog_categories c
     LEFT JOIN commerce.web_categories wc ON wc.pos_category_id = c.pos_category_id
     JOIN commerce.catalog_products p ON p.category_id = c.pos_category_id AND p.pos_active AND p.item_kind = 'stock'
     JOIN commerce.web_products w ON w.pos_product_id = p.pos_product_id AND w.status = 'published'
     LEFT JOIN commerce.product_images i ON i.pos_product_id = p.pos_product_id AND i.is_primary
     WHERE COALESCE(wc.visible, true)
     GROUP BY c.pos_category_id, c.name_en, wc.sort, wc.image_id
     ORDER BY COALESCE(wc.sort, 0), c.name_en`,
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name, imageUrl: imageUrl(r.object_key), productCount: Number(r.product_count) }));
}

export async function listDeliveryAreas(db: Db): Promise<{ id: string; name: string }[]> {
  return db.query<{ id: string; name: string }>('SELECT id, name FROM commerce.delivery_areas WHERE active ORDER BY name');
}

export async function activeBanner(db: Db): Promise<{ title: string; body: string; link: string | null; imageUrl: string | null } | null> {
  const [b] = await db.query<{ title: string; body: string; link: string | null; object_key: string | null }>(
    `SELECT b.title, b.body, b.link, i.object_key FROM commerce.banners b LEFT JOIN commerce.product_images i ON i.id = b.image_id WHERE b.active ORDER BY b.sort LIMIT 1`,
  );
  return b ? { title: b.title, body: b.body, link: b.link, imageUrl: imageUrl(b.object_key) } : null;
}
