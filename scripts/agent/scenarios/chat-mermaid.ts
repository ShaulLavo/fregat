import { ok } from 'node:assert/strict'
import { BUNDLED_THEMES } from '../../../packages/contracts/src/index'
import { preserveAppearance, writeUserSetting } from '../preserve-settings'
import { mermaidSelectors, selectors } from '../selectors'
import { isolatedNativeScenario, sendPrompt } from './native-provider-verification'

export const chatMermaid = isolatedNativeScenario({
  name: 'chat-mermaid',
  description:
    'Render a custom hidden class, then remeasure the diagram when its UI font and palette change.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step }) {
    const restore = await preserveAppearance(page, [
      'workbench.theme',
      'workbench.colorTheme',
      'workbench.fontFamily',
    ])
    const sage = BUNDLED_THEMES.find((theme) => theme.id === 'sage')
    ok(sage, 'The Sage theme is bundled')
    try {
      await writeUserSetting(page, 'workbench.colorTheme', 'dark')
      await sendPrompt(page, 'Render the Mermaid verification diagram.')
      const host = page.locator(mermaidSelectors.diagram).first()
      const svg = host.locator(mermaidSelectors.svg)
      await svg.waitFor({ timeout: 30_000 })
      await selectors.chatStop(page).waitFor({ state: 'hidden' })
      const node = svg.locator(mermaidSelectors.node).first()
      ok(await node.isVisible(), 'The custom hidden class remains visible')
      ok(
        await host.evaluate((element) => element.shadowRoot !== null),
        'The diagram has a shadow root',
      )
      const firstId = await svg.getAttribute('id')
      await step('dark-visible-custom-class')
      await writeUserSetting(page, 'workbench.fontFamily', 'bundled:jetbrains-mono')
      await page.waitForFunction(
        ({ diagram, original }) => {
          const svg = document.querySelector(diagram)?.shadowRoot?.querySelector('svg')
          return svg && svg.id !== original
        },
        { diagram: mermaidSelectors.diagram, original: firstId },
      )
      ok(await node.isVisible(), 'The label remains visible after font measurement')
      const fontId = await svg.getAttribute('id')
      await step('remeasured-font')
      await writeUserSetting(page, 'workbench.theme', sage)
      await page.waitForFunction(
        ({ diagram, original }) => {
          const svg = document.querySelector(diagram)?.shadowRoot?.querySelector('svg')
          return svg && svg.id !== original
        },
        { diagram: mermaidSelectors.diagram, original: fontId },
      )
      await step('sage-dark-palette')
      const darkId = await svg.getAttribute('id')
      await writeUserSetting(page, 'workbench.colorTheme', 'light')
      await page.waitForFunction(
        ({ diagram, original }) => {
          const svg = document.querySelector(diagram)?.shadowRoot?.querySelector('svg')
          return svg && svg.id !== original
        },
        { diagram: mermaidSelectors.diagram, original: darkId },
      )
      ok(await node.isVisible(), 'The label remains visible in the light palette')
      await step('sage-light-palette')
      return { firstId, fontId, darkId, lightId: await svg.getAttribute('id') }
    } finally {
      await restore()
    }
  },
})
