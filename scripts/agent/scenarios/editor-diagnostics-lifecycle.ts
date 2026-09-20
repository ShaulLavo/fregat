import type { Scenario } from './index'
import { openFileByName, selectors, waitForApp } from '../selectors'
import { createScriptError } from '../../structured-errors'

export const editorDiagnosticsLifecycle: Scenario = {
  name: 'editor-diagnostics-lifecycle',
  description: 'Open and close editors, opt into diagnostics, exceed retention, stop, and reload.',
  async run(page, { file, step }) {
    for (let index = 0; index < 3; index++) {
      await openFileByName(page, file)
      await selectors.editorInput(page).first().waitFor()
      await page.keyboard.press('Control+w')
    }
    await step('editors-closed')
    const url = new URL(page.url())
    url.searchParams.set('editorPerfTrace', '1')
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    await openFileByName(page, file)
    await step('trace-enabled')
    const result = await page.evaluate(() => {
      const host = window as typeof window & {
        __editorPerfTrace?: {
          mark(name: string): void
          reset(): void
          stop(): void
          report(): { traceEvents: unknown[]; frameStats: Record<string, number> }
        }
      }
      const trace = host.__editorPerfTrace
      if (!trace) return { available: false }
      trace.reset()
      for (let index = 0; index < 10020; index++) trace.mark('retention-control')
      const beforeStop = trace.report().traceEvents.length
      trace.stop()
      trace.mark('after-stop')
      return { available: true, beforeStop, afterStop: trace.report().traceEvents.length }
    })
    if (!result.available || result.beforeStop !== 5000 || result.afterStop !== 5000)
      throw createScriptError(`Diagnostic retention failed: ${JSON.stringify(result)}`)
    await step('bounded-and-stopped')
    url.searchParams.delete('editorPerfTrace')
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    await openFileByName(page, file)
    const retained = await page.evaluate(() => '__editorPerfTrace' in window)
    if (retained) throw createScriptError('Diagnostics remained active without URL activation')
    await step('ordinary-mode-restored')
  },
}
