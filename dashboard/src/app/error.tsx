'use client';

/** Never shows the cause, and never falls back to other figures. */
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="page">
      <h2 className="title">This page could not load</h2>
      <p className="notice bad">The figures could not be read just now. Nothing is shown rather than something wrong.</p>
      <button className="btn" type="button" onClick={reset}>Try again</button>
    </main>
  );
}
