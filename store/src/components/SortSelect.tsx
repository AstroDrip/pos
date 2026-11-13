'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function SortSelect({ value }: { value: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  return (
    <label className="flex items-center gap-2 text-sm text-ink-600">
      Sort
      <select
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          next.set('sort', e.target.value);
          router.push(`${path}?${next}`);
        }}
        className="min-h-11 cursor-pointer rounded-field bg-surface-soft px-3 font-medium text-ink-900 focus-visible:outline-2 focus-visible:outline-brand-700"
      >
        <option value="recommended">Recommended</option>
        <option value="name">Name</option>
        <option value="price_asc">Price: low to high</option>
        <option value="price_desc">Price: high to low</option>
      </select>
    </label>
  );
}
