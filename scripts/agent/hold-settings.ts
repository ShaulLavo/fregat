import type { Page, Route } from 'playwright'

export async function holdSettingsResponses(page: Page, base: string) {
  const gate = Promise.withResolvers<void>()
  const requested = Promise.withResolvers<void>()
  const paths = [`${base}/settings`, `${base}/settings/events`]
  const handler = async (route: Route) => {
    if (route.request().url() === paths[0]) requested.resolve()
    await gate.promise
    await route.continue()
  }
  for (const path of paths) await page.route(path, handler)
  return {
    requested: requested.promise,
    resume: () => gate.resolve(),
    close: async () => {
      gate.resolve()
      for (const path of paths) await page.unroute(path, handler)
    },
  }
}
