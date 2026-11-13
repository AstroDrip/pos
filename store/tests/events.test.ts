import { describe, expect, it } from 'vitest';
import { eventBatch, parseEventId, posCommand, syncEvent } from '../src/shared/commerce-events.ts';

const DEVICE = '11111111-1111-4111-8111-111111111111';
const envelope = { eventId: `${DEVICE}:0:1`, version: 1, occurredAt: '2026-11-10T09:30:00.000Z' };
const movement = { movementId: 7, productId: 3, qty: -2000, reason: 'sale', sourceType: 'sale', sourceId: 4, sourceLine: 1, orderId: null };
const product = { productId: 3, sku: 'SKU-3', nameEn: 'Made up apples', nameAr: '-', categoryId: null, unit: 'kg', sellMode: 'weight', itemKind: 'stock', priceIncl: 1150, vatRateBp: 1500, active: true, barcodes: ['6290000000001'] };

describe('sync event contract', () => {
  it('reads an event id', () => {
    expect(parseEventId(`${DEVICE}:2:15`)).toEqual({ deviceId: DEVICE, epoch: 2, seq: 15 });
    expect(parseEventId('nope')).toBeNull();
  });

  it('accepts a stock movement', () => {
    expect(syncEvent.safeParse({ ...envelope, type: 'stock.movement', payload: movement }).success).toBe(true);
  });

  it('refuses a movement of zero, because the ledger has none', () => {
    expect(syncEvent.safeParse({ ...envelope, type: 'stock.movement', payload: { ...movement, qty: 0 } }).success).toBe(false);
  });

  it('never accepts a cost field, on movements or products', () => {
    expect(syncEvent.safeParse({ ...envelope, type: 'stock.movement', payload: { ...movement, unitCost: 500 } }).success).toBe(false);
    expect(syncEvent.safeParse({ ...envelope, type: 'catalog.product', payload: { ...product, avgCost: 500 } }).success).toBe(false);
  });

  it('accepts a product', () => {
    expect(syncEvent.safeParse({ ...envelope, type: 'catalog.product', payload: product }).success).toBe(true);
  });

  it('an empty batch is the heartbeat', () => {
    expect(eventBatch.safeParse({ events: [] }).success).toBe(true);
  });

  it('refuses an unknown type or a bad id', () => {
    expect(syncEvent.safeParse({ ...envelope, type: 'order.delete', payload: {} }).success).toBe(false);
    expect(syncEvent.safeParse({ ...envelope, eventId: 'x:1', type: 'stock.movement', payload: movement }).success).toBe(false);
  });

  it('limits a batch to 200', () => {
    const e = { ...envelope, type: 'stock.movement', payload: movement };
    expect(eventBatch.safeParse({ events: Array(200).fill(e) }).success).toBe(true);
    expect(eventBatch.safeParse({ events: Array(201).fill(e) }).success).toBe(false);
  });

  it('accepts a POS command for an accepted order', () => {
    const r = posCommand.safeParse({ id: 1, type: 'order.accepted', payload: { orderId: DEVICE, publicRef: 'AB12CD34', fulfilment: 'pickup', paymentMethod: 'pay_at_pickup', customerName: 'Made Up', phone: '0500000000', lines: [{ productId: 3, qty: 1000, unitPriceIncl: 1150, discount: 0, isEstimate: false }], deliveryFeeIncl: 0 } });
    expect(r.success).toBe(true);
  });
});
