// A till that has gone quiet is a different thing from a shop with no sales.

export type Freshness = 'demo' | 'never' | 'live' | 'delayed' | 'offline';

export const LIVE_MINUTES = 30;
export const OFFLINE_HOURS = 6;

export function freshness(lastSuccessIso: string | null, now: Date, demo: boolean): Freshness {
  if (demo) return 'demo';
  if (!lastSuccessIso) return 'never';
  const age = now.getTime() - Date.parse(lastSuccessIso);
  if (age <= LIVE_MINUTES * 60_000) return 'live';
  return age <= OFFLINE_HOURS * 3_600_000 ? 'delayed' : 'offline';
}

export const FRESHNESS_TEXT: Record<Freshness, string> = {
  demo: 'Demo data. No till is connected.',
  never: 'No till has sent data yet.',
  live: 'Up to date.',
  delayed: 'The till has not reported recently. Figures may be out of date.',
  offline: 'The till is not connected. These figures are from its last report and may be out of date. This does not mean there were no sales.',
};

/** Time in Saudi Arabia, for humans. */
export function riyadhTime(iso: string | null): string {
  if (!iso) return 'Not available';
  const d = new Date(Date.parse(iso) + 3 * 3_600_000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)}`;
}
