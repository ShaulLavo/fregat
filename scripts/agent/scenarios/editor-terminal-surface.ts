import { deepStrictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { preserveAppearance, writeUserSetting } from '../preserve-settings'
import { openFileByName, selectors } from '../selectors'

type Layer = { readonly element: string; readonly background: string }

/** The editor and the terminal sit on the same surface, so neither paints a layer the other lacks. */
export const editorTerminalSurface: Scenario = {
  name: 'editor-terminal-surface',
  description:
    'Open a file and the terminal in light and dark, then compare every painted background behind and inside each.',
  async run(page, { step, file }) {
    const restore = await preserveAppearance(page, ['workbench.colorTheme'])
    try {
      await openFileByName(page, file)
      await selectors.editorGroupViewport(page, 0).waitFor()
      await selectors.terminalSurface(page).first().waitFor()
      for (const mode of ['light', 'dark']) {
        await writeUserSetting(page, 'workbench.colorTheme', mode)
        await page.locator(`html.${mode}`).waitFor()
        await page.waitForTimeout(500)
        await step(mode)
        const editor = await paintedLayers(
          page,
          '[data-editor-group-id] .editor-virtualized-viewport',
        )
        const terminal = await paintedLayers(page, '[data-slot="tool-pane"][aria-label="Terminal"]')
        deepStrictEqual(
          editor.map((layer) => layer.background),
          terminal.map((layer) => layer.background),
          `editor and terminal paint different layers in ${mode}: ${JSON.stringify({ editor, terminal })}`,
        )
      }
    } finally {
      await restore()
    }
  },
}

/** Painted backgrounds inside `selector` (wide ones only), then from it up to the root. */
function paintedLayers(page: Page, selector: string): Promise<readonly Layer[]> {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector)
    if (!root) return []
    const describe = (node: Element) =>
      `${node.tagName.toLowerCase()}.${[...node.classList].slice(0, 6).join('.')}`
    const painted = (node: Element) => {
      const style = getComputedStyle(node)
      if (style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.backgroundImage === 'none')
        return null
      return `${style.backgroundColor} ${style.backgroundImage}`
    }
    const layers: Layer[] = []
    const rootWidth = root.getBoundingClientRect().width
    for (const inner of root.querySelectorAll('*')) {
      const background = painted(inner)
      if (background && inner.getBoundingClientRect().width > rootWidth / 2)
        layers.push({ element: `inside ${describe(inner)}`, background })
    }
    for (let node: Element | null = root; node; node = node.parentElement) {
      const background = painted(node)
      if (background) layers.push({ element: describe(node), background })
    }
    return layers
  }, selector)
}
