declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
    gtag?: (...args: unknown[]) => void;
    plausible?: (eventName: string, options?: { props?: Record<string, unknown> }) => void;
  }
}

export type MarketingEventName =
  | 'marketing_cta_clicked'
  | 'pricing_cta_clicked'
  | 'pricing_section_viewed'
  | 'trial_flow_viewed';

type MarketingPayload = Record<string, string | number | boolean | null | undefined>;

function sanitizePayload(payload: MarketingPayload = {}) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

export function trackMarketingEvent(
  eventName: MarketingEventName,
  payload: MarketingPayload = {}
) {
  if (typeof window === 'undefined') return;

  const props = sanitizePayload(payload);

  window.dispatchEvent(
    new CustomEvent('riff:marketing-analytics', {
      detail: {
        eventName,
        props,
        timestamp: Date.now(),
      },
    })
  );

  window.dataLayer?.push({
    event: eventName,
    ...props,
  });

  if (typeof window.gtag === 'function') {
    window.gtag('event', eventName, props);
  }

  if (typeof window.plausible === 'function') {
    window.plausible(eventName, { props });
  }
}
