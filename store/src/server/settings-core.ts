import { z } from 'zod';
import type { Db } from '../../../dashboard/src/server/db-types.ts';
import { requirePermission, type StaffUser } from './auth-core.ts';
import { ApiError } from './errors.ts';

export interface StoreSettings {
  deliveryFeeIncl: number | null;
  deliveryVatBp: number;
  freeDeliveryThreshold: number;
  freeDeliveryBasis: 'after_discount_before_vat' | 'after_discount_incl_vat';
  staleMinutes: number;
  payMinutes: number;
  acceptMinutes: number;
  expiryPauseHours: number;
  paymentMethods: string[];
}

const minutes = z.number().int().min(1).max(1440);

export const settingsPatch = z.strictObject({
  deliveryFeeIncl: z.number().int().min(0).max(100_000).optional(),
  deliveryVatBp: z.number().int().min(0).max(10_000).optional(),
  freeDeliveryThreshold: z.number().int().min(0).max(10_000_000).optional(),
  freeDeliveryBasis: z.enum(['after_discount_before_vat', 'after_discount_incl_vat']).optional(),
  staleMinutes: minutes.optional(),
  payMinutes: minutes.optional(),
  acceptMinutes: minutes.optional(),
  expiryPauseHours: z.number().int().min(0).max(72).optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatch>;

const COLUMNS = `delivery_fee_incl AS "deliveryFeeIncl", delivery_vat_bp AS "deliveryVatBp", free_delivery_threshold AS "freeDeliveryThreshold",
  free_delivery_basis AS "freeDeliveryBasis", stale_minutes AS "staleMinutes", pay_minutes AS "payMinutes", accept_minutes AS "acceptMinutes", expiry_pause_hours AS "expiryPauseHours", payment_methods AS "paymentMethods"`;

export async function getSettings(db: Db): Promise<StoreSettings> {
  const [s] = await db.query<StoreSettings>(`SELECT ${COLUMNS} FROM commerce.store_settings WHERE id = 1`);
  if (!s) throw new Error('store_settings row is missing');
  return s;
}

export async function updateSettings(db: Db, user: StaffUser, raw: SettingsPatch): Promise<StoreSettings> {
  requirePermission(user, 'settings.manage');
  const parsed = settingsPatch.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'INVALID', 'Those settings are not valid.');
  const p = parsed.data;
  await db.batch([
    {
      text: `UPDATE commerce.store_settings SET
        delivery_fee_incl = COALESCE($1::integer, delivery_fee_incl),
        delivery_vat_bp = COALESCE($2::integer, delivery_vat_bp),
        free_delivery_threshold = COALESCE($3::integer, free_delivery_threshold),
        free_delivery_basis = COALESCE($4::text, free_delivery_basis),
        stale_minutes = COALESCE($5::integer, stale_minutes),
        pay_minutes = COALESCE($6::integer, pay_minutes),
        accept_minutes = COALESCE($7::integer, accept_minutes),
        expiry_pause_hours = COALESCE($8::integer, expiry_pause_hours),
        updated_at = now()
        WHERE id = 1`,
      params: [p.deliveryFeeIncl ?? null, p.deliveryVatBp ?? null, p.freeDeliveryThreshold ?? null, p.freeDeliveryBasis ?? null, p.staleMinutes ?? null, p.payMinutes ?? null, p.acceptMinutes ?? null, p.expiryPauseHours ?? null],
    },
    { text: "INSERT INTO commerce.audit_log (actor, actor_id, action, entity, detail) VALUES ('staff', $1, 'settings.update', 'store_settings', $2)", params: [String(user.userId), JSON.stringify(p)] },
  ]);
  return getSettings(db);
}
