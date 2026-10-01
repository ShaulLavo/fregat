import type { Page } from 'playwright'

export type ScenarioApi = Pick<Page, 'request' | 'url'>

export function captureScenarioApi(page: ScenarioApi): ScenarioApi {
  const url = page.url()
  return { request: page.request, url: () => url }
}

export async function cleanupAll(actions: readonly (() => Promise<unknown>)[]) {
  const failures: unknown[] = []
  for (const action of actions) {
    try {
      await action()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Scenario cleanup failed')
}
