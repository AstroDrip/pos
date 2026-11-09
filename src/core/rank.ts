// How past sales order products inside one search match level. Pure rules; the counts come from services/demand.ts.
// These are guesses from history. They never move a product above a stronger match, and never hide one.

export const MAX_SIGNAL_BOOST = 1.5;
export const MAX_TOTAL_BOOST = 2;
/** The whole store needs this much history before time or day patterns are trusted. */
export const MIN_STORE_DAYS = 28;
/** A product needs this many sales in 90 days. */
export const MIN_PRODUCT_SALES = 8;
/** Net sales a day (the demand score) at which an item is called "Often bought". */
export const OFTEN_BOUGHT_MIN = 0.5;
/** How many times more than average at this hour before saying "Usually sold around now". */
export const NOW_LIFT_MIN = 1.5;

/** How a product's share of sales in a slot compares with an even spread. No pattern counts as average. */
export const liftOf = (share: number | null, parts: number): number => (share === null ? 1 : share * parts);

const boost = (lift: number) => Math.min(MAX_SIGNAL_BOOST, Math.max(1, lift));

export function rankScore(s: { history: number; hourShare: number | null; dayShare: number | null }): number {
  return s.history * Math.min(MAX_TOTAL_BOOST, boost(liftOf(s.hourShare, 6)) * boost(liftOf(s.dayShare, 7)));
}
