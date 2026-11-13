'use client';

import { Button } from '@/components/ui';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-ink-600">The shop could not load. Your cart is safe on this device.</p>
      <Button type="button" className="mt-6" onClick={reset}>Try again</Button>
    </main>
  );
}
