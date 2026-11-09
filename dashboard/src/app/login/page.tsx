import { redirect } from 'next/navigation';
import { loginAction } from '@/app/actions';
import { demoModeOn } from '@/server/db';
import { currentUser } from '@/server/session';

export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  invalid: 'Wrong username or password.',
  locked: 'Too many wrong tries. Wait 15 minutes and try again.',
  offline: 'The service is not reachable right now. Please try again.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if (await currentUser()) redirect('/');
  const { e } = await searchParams;
  const demo = demoModeOn();
  return (
    <main className="login">
      <form action={loginAction}>
        {demo && <div className="demo-banner" style={{ borderRadius: 8 }}>DEMO MODE: MADE-UP DATA</div>}
        <div>
          <h1>Store dashboard</h1>
          <p className="sub">See sales, stock and money from your phone. Nothing can be changed here.</p>
        </div>
        {e && MESSAGES[e] && <p className="notice bad" role="alert">{MESSAGES[e]}</p>}
        <label>Username<input name="username" autoComplete="username" autoCapitalize="none" required maxLength={40} /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={200} /></label>
        <button className="btn" type="submit">Log in</button>
        {demo && <p className="sub">To try the demo, log in as <b>demo</b> with the test password set when the demo was loaded.</p>}
      </form>
    </main>
  );
}
