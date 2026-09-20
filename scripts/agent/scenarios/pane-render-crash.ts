import type { Scenario } from './index'
import { selectors } from '../selectors'

/** A render failure inside one pane must stay in that pane, and Retry must bring it back. */
export const paneRenderCrash: Scenario = {
  name: 'pane-render-crash',
  description: 'Make the log rows throw while rendering, check the rest of the app, then retry.',
  async run(page, { step }) {
    await selectors.logsTab(page).click()
    await selectors.logRows(page).first().waitFor({ timeout: 20_000 })
    // Fault injection from outside. Matched on the log formatters' options, not a
    // stack path, so it also works against the minified mesh build.
    await page.evaluate(() => {
      const proto = Intl.DateTimeFormat.prototype
      const original = Object.getOwnPropertyDescriptor(proto, 'format')
      if (!original?.get) return
      const readFormat = original.get
      Object.assign(window, {
        __restoreDateFormat: () => Object.defineProperty(proto, 'format', original),
      })
      Object.defineProperty(proto, 'format', {
        configurable: true,
        get(this: Intl.DateTimeFormat) {
          const { second, year } = this.resolvedOptions()
          if (second === '2-digit' && year === undefined) throw new TypeError('injected crash')
          return readFormat.call(this)
        },
      })
    })
    await selectors.logsSearch(page).fill('request')
    await selectors.renderErrorState(page).waitFor({ timeout: 20_000 })
    await selectors.windowToolbar(page).waitFor()
    await selectors.logsTab(page).waitFor()
    await step('crashed-pane-contained')

    await page.evaluate(() =>
      (window as unknown as Record<string, () => void>).__restoreDateFormat(),
    )
    await selectors.renderErrorRetry(page).click()
    await selectors.logRows(page).first().waitFor({ timeout: 20_000 })
    await step('retried-pane-restored')
    await selectors.logsSearch(page).fill('')
  },
}
