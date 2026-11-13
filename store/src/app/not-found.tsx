import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">
      <h1 className="text-2xl font-bold">We could not find that</h1>
      <p className="mt-2 text-ink-600">It may have moved, or it is no longer sold online.</p>
      <Link href="/" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-brand-900 px-6 font-semibold text-white">Back to the shop</Link>
    </main>
  );
}
