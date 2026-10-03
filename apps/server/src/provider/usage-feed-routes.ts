import { Elysia } from 'elysia'
import { providerUsageFeedSchema } from '@workspace/contracts'
import type { ProviderUsageStore } from './usage-store'

/** One sanitized cache-only GET is public to the private mesh; other provider routes retain guards. */
export function providerUsageFeedRoutes(usage: Pick<ProviderUsageStore, 'feed'>) {
  return new Elysia({ name: 'provider-usage-feed' }).get(
    '/providers/usage/feed',
    () => usage.feed(),
    {
      response: providerUsageFeedSchema,
    },
  )
}
