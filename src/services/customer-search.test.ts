import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from './context';
import { createCustomer, findCustomers } from './parties';
import { makeTestCtx, seedUsers } from './test-helpers';

let t: ReturnType<typeof makeTestCtx>;
let ctx: Ctx;
let u: ReturnType<typeof seedUsers>;
const names = (text: string) => findCustomers(ctx, text).map((c) => c.name);

beforeEach(() => {
  t = makeTestCtx();
  ctx = t.ctx;
  u = seedUsers(ctx);
  createCustomer(ctx, u.admin, { name: 'Amal Stores', phone: '0500000001', vatNumber: '300000000000103' });
  createCustomer(ctx, u.admin, { name: 'أحمد', phone: '0500000002' });
  createCustomer(ctx, u.admin, { name: 'مدرسة النور', phone: '0500000003' });
});
afterEach(() => t.cleanup());

describe('customer search', () => {
  it('finds by name, phone and VAT number', () => {
    expect(names('Amal')).toEqual(['Amal Stores']);
    expect(names('0500000001')).toEqual(['Amal Stores']);
    expect(names('300000000000103')).toEqual(['Amal Stores']);
  });

  it('أحمد finds احمد and the other way round', () => {
    expect(names('احمد')).toEqual(['أحمد']);
    expect(names('أحمد')).toEqual(['أحمد']);
  });

  it('matches ة and ه as the same letter', () => expect(names('مدرسه')).toEqual(['مدرسة النور']));

  it('English search ignores case', () => expect(names('amal')).toEqual(['Amal Stores']));

  it('finds from the first letter', () => expect(names('A')).toContain('Amal Stores'));

  it('wildcards are not patterns', () => {
    for (const text of ['%', '_', '%%', "'", '"']) expect(names(text), text).toEqual([]);
  });

  it('blank returns nothing', () => expect(names('   ')).toEqual([]));

  // About 30 ms on a quiet machine. The limit only catches something badly wrong: the test suite shares the machine.
  it('20,000 customers answer quickly', () => {
    ctx.db.transaction(() => {
      const add = ctx.db.prepare('INSERT INTO customers (name, phone, created_at) VALUES (?, ?, ?)');
      for (let i = 0; i < 20_000; i++) add.run(`Made Up Customer ${i}`, `05${String(i).padStart(8, '0')}9`, ctx.now());
    })();
    const best = Math.min(...[1, 2, 3, 4, 5].map(() => {
      const start = performance.now();
      findCustomers(ctx, 'customer 1999');
      return performance.now() - start;
    }));
    expect(best).toBeLessThan(500);
  }, 30_000);
});
