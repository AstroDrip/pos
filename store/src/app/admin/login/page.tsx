import { redirect } from 'next/navigation';
import { loginAction } from '@/app/actions';
import { Button, Field } from '@/components/ui';
import { readEnv } from '@/server/env';
import { currentStaff } from '@/server/session';

export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  invalid: 'That username or password is not right.',
  locked: 'Too many tries. Please wait 15 minutes and try again.',
  offline: 'The service is not available right now. Please try again.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if (await currentStaff()) redirect('/admin');
  const { e } = await searchParams;
  const message = e ? MESSAGES[e] : undefined;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-soft p-4">
      <form action={loginAction} className="w-full max-w-sm space-y-4 rounded-card bg-surface p-6 shadow-float">
        <div>
          <h1 className="text-2xl font-bold">Staff sign in</h1>
          <p className="mt-1 text-sm text-ink-600">{readEnv().displayName}</p>
        </div>
        {readEnv().demo && (
          <p role="note" className="rounded-field bg-surface-soft p-3 text-sm">
            {readEnv().demoPassword ? 'Demo: sign in as demo, with the password set in STORE_DEMO_PASSWORD on the host.' : 'Demo: staff sign-in is off. Set STORE_DEMO_PASSWORD on the host to turn it on.'}
          </p>
        )}
        {message && <p role="alert" className="rounded-field bg-surface-soft p-3 text-sm text-danger">{message}</p>}
        <Field label="Username" name="username" autoComplete="username" required maxLength={40} />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required maxLength={200} />
        <Button type="submit" className="w-full">Sign in</Button>
      </form>
    </main>
  );
}
