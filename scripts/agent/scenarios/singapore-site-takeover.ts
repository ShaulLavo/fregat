import { singaporeSiteSelectors as site } from '../selectors'
import { createScriptError } from '../../structured-errors'
import type { Scenario } from './index'

export const singaporeSiteTakeover: Scenario = {
  name: 'singapore-site-takeover',
  surface: 'site',
  readOnly: true,
  description:
    'Switch the Singapore home sample and manual between captured paint and live editing.',
  async run(page, { step }) {
    const origin = new URL(page.url())
    const base = origin.pathname.replace(/\/?$/, '/')
    for (const surface of ['home', 'manual'] as const) {
      await page.goto(
        `${origin.origin}${base}${surface === 'manual' ? 'docs/start-here/quick-start/' : ''}?editor=off`,
      )
      await site.static(page).waitFor()
      const document = surface === 'home' ? site.home(page) : site.manual(page)
      const before = await document.boundingBox()
      await step(`${surface}-captured`)
      await site.goLive(page).click()
      await site.live(page).waitFor()
      const after = await document.boundingBox()
      if (before?.height !== after?.height)
        throw createScriptError('The document height changed on editor takeover.', {
          internal: { before: before?.height, after: after?.height, surface },
        })
      const extents = await page
        .locator('.editor-host .editor-virtualized')
        .evaluate((element) => ({
          horizontal: element.scrollWidth - element.clientWidth,
          vertical: element.scrollHeight - element.clientHeight,
        }))
      if (extents.horizontal || extents.vertical)
        throw createScriptError('The embedded editor owns a scroll area.', {
          internal: { ...extents, surface },
        })
      await step(`${surface}-live`)
      await site.goStatic(page).click()
      await site.static(page).waitFor()
      await step(`${surface}-returned-static`)
    }
  },
}
