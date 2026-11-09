import type { ReactNode } from 'react';
import { Nav } from '@/components/Nav';
import { FRESHNESS_TEXT, riyadhTime } from '@/lib/freshness';
import { shortDay } from '@/lib/period';
import { loadStatus } from '@/server/data';
import { requireUser } from '@/server/session';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const s = await loadStatus(user);
  return (
    <div className="shell">
      {s.demo && <div className="demo-banner" role="status">DEMO DATA: MADE-UP SHOP, NOT A REAL STORE</div>}
      <header className="topbar">
        <h1>{s.storeName}</h1>
        <span className="day">{s.demo ? 'Demo day: ' : ''}{shortDay(s.today)}</span>
      </header>
      {(s.freshness === 'delayed' || s.freshness === 'offline' || s.freshness === 'never') && (
        <p className="notice warn" role="status" style={{ borderRadius: 0 }}>
          {FRESHNESS_TEXT[s.freshness]} {s.lastSuccessAt && <>Last report: {riyadhTime(s.lastSuccessAt)}.</>}
        </p>
      )}
      {children}
      <Nav />
    </div>
  );
}
