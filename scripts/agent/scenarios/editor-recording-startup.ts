import { strictEqual, ok } from 'node:assert/strict'
import type { Scenario } from './index'
import { openFileByName, selectors, waitForApp } from '../selectors'

export const editorRecordingStartup: Scenario = {
  name: 'editor-recording-startup',
  description:
    'Keep startup usable while recording loads, replay early events, and survive a failed download.',
  requiresIsolatedServer: true,
  async run(page, { file, step, evidence }) {
    await waitForApp(page)
    const routePattern = '**/src/features/editor/state/performance-recording.ts*'
    const gate = Promise.withResolvers<void>()
    const requested = Promise.withResolvers<void>()
    const continued = Promise.withResolvers<void>()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route(routePattern, async (route) => {
      requested.resolve()
      await gate.promise
      await route.continue()
      continued.resolve()
    })
    const url = new URL(page.url())
    url.searchParams.set('editorPerfTrace', '1')
    try {
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })
      await requested.promise
      await waitForApp(page)
      await openFileByName(page, file)
      const at = await page.evaluate(() => {
        const host = window as typeof window & {
          __EDITOR_PERFORMANCE_DIAGNOSTICS__?: {
            record(value: { name: string; timestampMs: number }): void
          }
        }
        const timestampMs = performance.now()
        host.__EDITOR_PERFORMANCE_DIAGNOSTICS__?.record({
          name: 'startup-before-recording',
          timestampMs,
        })
        return timestampMs
      })
      await step('app-ready-with-recording-download-held')
      gate.resolve()
      await page.waitForFunction(() => '__editorPerfTrace' in window)
      const events = await page.evaluate(() => {
        const host = window as typeof window & {
          __editorPerfTrace: {
            report(): { traceEvents: { at: number; diagnostic?: { name: string } }[] }
          }
        }
        return host.__editorPerfTrace.report().traceEvents
      })
      const replay = events.find((event) => event.diagnostic?.name === 'startup-before-recording')
      ok(replay)
      strictEqual(replay.at, at)
      ok(
        events.some(
          (event) => event.diagnostic?.name === 'editor.document.attach' && event.at <= at,
        ),
      )
      await evidence.json('replayed-early-events.json', events)
      await step('early-diagnostics-replayed')
    } finally {
      gate.resolve()
      await continued.promise
      await page.unroute(routePattern)
    }
    const failed = Promise.withResolvers<void>()
    await page.route(routePattern, async (route) => {
      await route.abort('failed')
      failed.resolve()
    })
    const report = page.waitForRequest(
      (request) =>
        request.url().includes('/_log/ingest') &&
        Boolean(request.postData()?.includes('editor.performance_recording_load_failed')),
      { timeout: 30_000 },
    )
    void report.catch(() => undefined)
    try {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await failed.promise
      await waitForApp(page)
      await selectors.editorInput(page).first().waitFor()
      const payload = (await report).postData() ?? ''
      ok(payload.includes('RECORDING_LOAD_FAILED'))
      await evidence.write('recording-load-failure.json', payload)
      strictEqual(errors.length, 0)
      await step('app-ready-after-recording-download-failed')
    } finally {
      await page.unroute(routePattern)
    }
    url.searchParams.delete('editorPerfTrace')
    url.searchParams.set('editorPerfDisable', 'caret')
    let downloads = 0
    page.on('request', (request) => {
      if (request.url().includes('/state/performance-recording.ts')) downloads += 1
    })
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    strictEqual(
      await page.evaluate(() => document.documentElement.dataset.editorPerfDisable),
      'caret',
    )
    strictEqual(downloads, 0)
    await step('feature-controls-ready-without-recording-download')
  },
}
