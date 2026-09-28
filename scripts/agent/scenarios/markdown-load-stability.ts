import { editorRowSelector, markdownPreviewRowSelector } from '../selectors'
import type { Scenario } from './index'

export const markdownLoadStability: Scenario = {
  name: 'markdown-load-stability',
  description: 'Capture Markdown rows, tables and links through repeated page loads.',
  readOnly: true,
  async run(page, { evidence, step }) {
    const frames: unknown[] = []
    await page.exposeFunction('recordMarkdownFrame', (frame: unknown) => frames.push(frame))
    await page.addInitScript(
      ({ rows, preview }) => {
        let previous = ''
        const sample = () => {
          const state = {
            rows: Array.from(document.querySelectorAll(rows))
              .filter((row) => row.checkVisibility({ visibilityProperty: true }))
              .map((row) => row.textContent),
            previewRows: document.querySelectorAll(preview).length,
            tables: document.querySelectorAll('table').length,
            links: Array.from(document.querySelectorAll('a[href]'), (link) => ({
              text: link.textContent,
              href: link.getAttribute('href'),
            })),
          }
          const serialized = JSON.stringify(state)
          if (serialized !== previous) {
            previous = serialized
            Reflect.get(window, 'recordMarkdownFrame')({ time: performance.now(), ...state })
          }
          if (performance.now() < 10_000) requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      },
      { rows: editorRowSelector, preview: markdownPreviewRowSelector },
    )
    for (let load = 1; load <= 4; load++) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(500)
      await step(`load-${load}-early`)
      await page.waitForTimeout(4000)
      await step(`load-${load}-settled`)
      await evidence.json(`load-${load}.json`, frames.splice(0))
    }
  },
}
