/**
 * Thin analytics wrapper around PostHog.
 * All calls are no-ops if NEXT_PUBLIC_POSTHOG_KEY is not set or PostHog hasn't loaded.
 */

export type AnalyticsEvent =
  | 'survey_opened'
  | 'city_selected'
  | 'question_answered'
  | 'picks_viewed'
  | 'ticket_clicked'
  | 'gps_located'
  | 'picks_shared'
  | 'email_subscribed'
| 'event_saved'
| 'event_unsaved'

export function capture(event: AnalyticsEvent, props?: Record<string, unknown>) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ph = (window as any).posthog
    if (ph && typeof ph.capture === 'function') {
      ph.capture(event, props)
    }
  } catch {
    // PostHog not loaded — silently ignore
  }
}
