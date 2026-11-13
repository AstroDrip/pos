import { finishWelcome } from '@/app/actions';
import { Button } from '@/components/ui';
import { readEnv } from '@/server/env';

export const dynamic = 'force-dynamic';

const FLOATING: { src: string; className: string }[] = [
  { src: 'mix', className: 'top-1/2 left-1/2 w-[min(82%,30rem)] -translate-x-1/2 -translate-y-1/2' },
  { src: 'banana', className: 'top-[8%] left-[8%] w-16 -rotate-12 lg:w-24' },
  { src: 'tomato', className: 'top-[14%] right-[10%] w-14 rotate-12 lg:w-20' },
  { src: 'carrot', className: 'bottom-[12%] left-[10%] w-14 rotate-45 lg:w-20' },
  { src: 'orange', className: 'right-[8%] bottom-[16%] w-12 lg:w-16' },
];

export default function Welcome() {
  return (
    <main className="flex min-h-dvh flex-col bg-brand-900 lg:flex-row">
      <div className="relative min-h-72 flex-1">
        {FLOATING.map((f) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={f.src} src={`/demo/${f.src}.svg`} alt="" className={`absolute ${f.className}`} />
        ))}
        <form action={finishWelcome} className="absolute top-3 right-3">
          <button type="submit" className="min-h-11 cursor-pointer px-3 font-medium text-white">Skip</button>
        </form>
      </div>
      <section className="rounded-t-[2.5rem] bg-surface px-6 pt-10 pb-8 text-center lg:flex lg:w-[34rem] lg:flex-col lg:justify-center lg:rounded-t-none lg:rounded-l-[3rem] lg:px-16">
        <p className="text-sm font-semibold text-brand-700">{readEnv().displayName}</p>
        <h1 className="mt-2 text-[2rem] leading-tight font-bold">Fresh groceries, your way</h1>
        <p className="mx-auto mt-3 max-w-sm text-ink-600">Order from your local store for home delivery, or collect it yourself.</p>
        <form action={finishWelcome} className="mt-8">
          <Button type="submit" className="w-full">Start shopping</Button>
        </form>
      </section>
    </main>
  );
}
