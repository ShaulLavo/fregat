import type { BrowserContext } from 'playwright'
import { BOOTSTRAP_API_HEADER } from '../../apps/web/scripts/html-bootstrap-plugin'

/** Document requests remain real network responses while Vite uses the fixture's Bun renderer. */
export async function routeHtmlBootstrap(context: BrowserContext, webUrl: string, apiBase: string) {
  await context.route(`${new URL(webUrl).origin}/**`, async (route) => {
    const request = route.request()
    if (request.resourceType() !== 'document') return route.continue()
    await route.continue({ headers: { ...request.headers(), [BOOTSTRAP_API_HEADER]: apiBase } })
  })
}
