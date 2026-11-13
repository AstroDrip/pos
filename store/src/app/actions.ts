'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { logIn, logOut } from '@/server/session';

/** Start shopping and Skip both end the welcome screen for good on this device. */
export async function finishWelcome(): Promise<void> {
  (await cookies()).set('store_welcome', '1', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 31_536_000, secure: process.env.NODE_ENV === 'production' });
  redirect('/');
}

export async function loginAction(form: FormData): Promise<void> {
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const result = await logIn(String(form.get('username') ?? ''), String(form.get('password') ?? ''), ip);
  redirect(result === 'ok' ? '/admin' : `/admin/login?e=${result}`);
}

export async function logoutAction(): Promise<void> {
  await logOut();
  redirect('/admin/login');
}
