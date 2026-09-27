import type { Scenario } from './index'
import { selectors, waitForApp } from '../selectors'
import { createScriptError } from '../../structured-errors'

export const startupFailure: Scenario = {
  name: 'startup-failure',
  description:
    'A pre-render startup exception reports a structured error and offers a working reload.',
  requiresIsolatedServer: true,
  async run(page, { step, evidence }) {
    await waitForApp(page)
    await step('healthy-boot')
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(() => {
      if (sessionStorage.getItem('startup-failure-injected')) return
      const addEventListener = MediaQueryList.prototype.addEventListener
      MediaQueryList.prototype.addEventListener = function (
        ...args: Parameters<typeof addEventListener>
      ) {
        if (this.media === '(pointer: coarse)') {
          sessionStorage.setItem('startup-failure-injected', 'true')
          throw new DOMException('Forced shell listener failure', 'NotSupportedError')
        }
        return addEventListener.apply(this, args)
      }
    })
    const report = page.waitForRequest(
      (request) =>
        request.url().includes('/_log/ingest') &&
        Boolean(request.postData()?.includes('app.startup_failed')),
      { timeout: 30_000 },
    )
    // Keep the report timeout handled even when the missing fallback fails first.
    void report.catch(() => undefined)
    await page.reload()
    await selectors.startupFailure(page).waitFor({ timeout: 15_000 })
    await selectors.reloadApp(page).waitFor()
    await step('startup-failure')
    const payload = (await report).postData() ?? ''
    if (!payload.includes('BOOT_FAILED') || !payload.includes('Forced shell listener failure'))
      throw createScriptError(
        'The startup report must retain its structured code and original cause.',
      )
    await evidence.write('startup-report.json', payload)
    if (errors.length) throw createScriptError(`Unhandled startup errors: ${errors.join(', ')}`)
    await selectors.reloadApp(page).click()
    await waitForApp(page)
    await step('recovered-after-reload')
  },
}
