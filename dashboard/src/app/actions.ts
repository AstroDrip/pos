'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { logIn, logOut } from '@/server/session';

// The only two server actions in this app. Neither touches a store record. Next checks Origin against Host on each.

export async function loginAction(form: FormData): Promise<void> {
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const result = await logIn(String(form.get('username') ?? ''), String(form.get('password') ?? ''), ip);
  if (result !== 'ok') redirect(`/login?e=${result}`);
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  await logOut();
  redirect('/login');
}
