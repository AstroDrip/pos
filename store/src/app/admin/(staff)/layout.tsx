import type { ReactNode } from 'react';
import { logoutAction } from '@/app/actions';
import { AdminNav } from '@/components/admin/AdminNav';
import { readEnv } from '@/server/env';
import { requireStaff } from '@/server/session';

export const dynamic = 'force-dynamic';

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const user = await requireStaff();
  return (
    <div className="min-h-dvh bg-surface-soft">
      <header className="bg-brand-900 text-white">
        <div className="mx-auto flex max-w-admin flex-wrap items-center justify-between gap-x-4 px-4 pt-2">
          <p className="py-2 font-semibold">{readEnv().displayName} admin</p>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-white/80 sm:inline">{user.displayName} · {user.role}</span>
            <form action={logoutAction}>
              <button type="submit" className="min-h-11 cursor-pointer rounded-full px-3 font-semibold hover:bg-white/10">Sign out</button>
            </form>
          </div>
          <div className="w-full"><AdminNav canProducts={user.permissions.has('products.edit')} canStock={user.permissions.has('stock.view')} /></div>
        </div>
      </header>
      <main className="mx-auto max-w-admin p-4 lg:p-6">{children}</main>
    </div>
  );
}
