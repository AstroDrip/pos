import { formatMoney } from '../../../src/core/money';

// Draws what the server worked out. Width comes from one value in one element, so an animation can be added here later
// without touching the cart or checkout.
export interface FreeDeliveryFacts {
  eligibleSubtotal: number;
  threshold: number;
  thresholdBeforeVat: boolean;
  freeDelivery: boolean;
  remainingForFree: number;
  standardFeeIncl: number | null;
}

export function FreeDeliveryProgress({ facts, updating }: { facts: FreeDeliveryFacts; updating: boolean }) {
  const { eligibleSubtotal, threshold, freeDelivery, remainingForFree, standardFeeIncl, thresholdBeforeVat } = facts;
  const progress = freeDelivery ? 100 : threshold > 0 ? Math.min(99, Math.floor((eligibleSubtotal * 100) / (threshold + 1))) : 0;
  return (
    <section aria-label="Free delivery progress" aria-busy={updating} className={`rounded-card p-4 ${freeDelivery ? 'bg-brand-100' : 'bg-surface-soft'}`}>
      <p className="font-semibold" role="status">{freeDelivery ? 'You’ve unlocked free delivery!' : `Add ${formatMoney(remainingForFree)} more to unlock free delivery.`}</p>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Progress to free delivery" className="mt-2 h-2 overflow-hidden rounded-full bg-line">
        <div data-progress={progress} className={`h-full rounded-full ${freeDelivery ? 'bg-brand-900' : 'bg-leaf-500'}`} style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-2 text-xs text-ink-600">
        {formatMoney(eligibleSubtotal)} of over {formatMoney(threshold)}{thresholdBeforeVat ? ', counting items before VAT' : ''}.
        {!freeDelivery && standardFeeIncl !== null && ` Delivery is ${formatMoney(standardFeeIncl)} until then.`}
      </p>
    </section>
  );
}
