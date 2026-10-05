import type { Page } from 'playwright'
import type { Evidence } from './evidence'

// A scenario body can capture in its catch before its fixture finally changes the page.
// Evidence failures stay secondary to the original scenario error.
export async function captureScenarioFailure(
  page: Page,
  evidence: Evidence,
  phase: 'before-cleanup' | 'after-scenario',
) {
  const stem = `failure-${phase}`
  const startedAt = new Date().toISOString()
  const urlBefore = page.url()
  const screenshot = await page
    .screenshot({ path: evidence.file(`${stem}.png`) })
    .then(() => ({ status: 'captured' as const, file: `${stem}.png` }))
    .catch((error: unknown) => ({
      status: 'failed' as const,
      error: error instanceof Error ? error.message : String(error),
    }))
  const capture = {
    phase,
    startedAt,
    finishedAt: new Date().toISOString(),
    urlBefore,
    urlAfter: page.url(),
    screenshot,
  }
  await evidence.json(`${stem}.json`, capture).catch(() => undefined)
  return capture
}
