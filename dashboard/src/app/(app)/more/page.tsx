import Link from 'next/link';
import { logoutAction } from '@/app/actions';
import { ThemeButton } from '@/components/ThemeButton';
import { requireUser } from '@/server/session';

export default async function MorePage() {
  const user = await requireUser();
  return (
    <main className="page">
      <h2 className="title">More</h2>
      <div className="card">
        <Link className="link-row" href="/credit"><span>Customers and suppliers</span><span aria-hidden="true">›</span></Link>
        <Link className="link-row" href="/sync"><span>Till connection</span><span aria-hidden="true">›</span></Link>
        <ThemeButton />
      </div>
      <p className="sub">This dashboard only shows information. Sales, stock, prices and payments are changed on the till.</p>
      <form action={logoutAction}><button className="btn plain" style={{ width: '100%' }} type="submit">Log out ({user.displayName})</button></form>
    </main>
  );
}
