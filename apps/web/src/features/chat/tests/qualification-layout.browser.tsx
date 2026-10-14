import { page, server } from 'vitest/browser'

import { expect, test } from '../../../../test/fixtures'
import { createMarkdownBrowser, requiredElement } from '../../../../test/factories/markdown-browser'

test.each(['first  \nsecond', 'first\\\nsecond'])(
  'a Markdown hard break has the height of one native line break: %j',
  async (source) => {
    const proof = await createMarkdownBrowser({ width: 390 })
    await proof.update(source)
    const paragraph = requiredElement(proof.host, 'p')
    const control = paragraph.cloneNode(false)
    expect(control).toBeInstanceOf(HTMLElement)
    if (!(control instanceof HTMLElement)) return
    control.append('first', document.createElement('br'), 'second')
    paragraph.parentElement?.append(control)
    const actual = paragraph.getBoundingClientRect().height
    const native = control.getBoundingClientRect().height
    expect(native).toBeGreaterThan(0)
    console.info(
      'MARKDOWN_LAYOUT_CONTROL ' +
        JSON.stringify({
          source,
          actual,
          native,
          whiteSpace: getComputedStyle(paragraph).whiteSpace,
        }),
    )
    await page.screenshot({
      element: proof.host,
      path: `markdown-baseline/${server.browser}/hard-break-control-${source.includes('\\') ? 'backslash' : 'spaces'}.png`,
    })
    expect(actual).toBeCloseTo(native, 1)
  },
)
