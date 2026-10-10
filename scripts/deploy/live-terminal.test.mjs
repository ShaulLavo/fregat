import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { terminalFailures, waitForTerminalPrompt } from './live-terminal.mjs'

const rendered = {
  count: 1,
  promptRendered: true,
  rendererBackend: 'webgpu',
  closed: true,
}

test.each(['webgpu', 'webgl2', 'canvas2d', 'dom'])(
  'accepts a rendered prompt with renderer %s and successful cleanup',
  (rendererBackend) => {
    expect(terminalFailures({ ...rendered, rendererBackend })).toEqual([])
  },
)

test('rejects a page that mounted no terminals', () => {
  expect(terminalFailures({ ...rendered, count: 0 })).toContain(
    'terminal check: no terminal mounted',
  )
})

test('a mounted canvas alone does not prove that the shell prompt rendered', () => {
  expect(terminalFailures({ ...rendered, promptRendered: false })).toContain(
    'terminal check: shell prompt did not render',
  )
})

test.each([undefined, null, '', 'starting'])(
  'rejects an unselected renderer %s',
  (rendererBackend) => {
    expect(terminalFailures({ ...rendered, rendererBackend })).toContain(
      'terminal check: renderer backend was not selected',
    )
  },
)

test('rejects a terminal that was left running', () => {
  expect(terminalFailures({ ...rendered, closed: false })).toContain(
    'terminal check: terminal cleanup did not complete',
  )
})

const browserAvailable = existsSync(chromium.executablePath())
let browser
beforeAll(async () => {
  if (browserAvailable) browser = await chromium.launch({ headless: true })
})
afterAll(async () => {
  await browser?.close()
})

// Browser-signal tests skip when a fresh contributor checkout has no Playwright browser.
test
  .skipIf(!browserAvailable)
  .each([
    '',
    '<div data-slot="tool-pane" aria-label="Terminal"><div class="ghostty-webgpu"><canvas></canvas></div></div>',
    '<div hidden data-slot="tool-pane" aria-label="Terminal"><div class="ghostty-webgpu"><div aria-label="Terminal screen">check$ </div></div></div>',
    '<div aria-label="Terminal screen">check$ </div>',
    '<div data-slot="tool-pane" aria-label="Terminal"><div class="ghostty-webgpu" style="opacity:0"><div aria-label="Terminal screen">check$</div></div></div>',
    '<div data-slot="tool-pane" aria-label="Terminal"><div class="ghostty-webgpu" style="visibility:hidden"><div aria-label="Terminal screen">check$</div></div></div>',
    '<div style="opacity:0" data-slot="tool-pane" aria-label="Terminal"><div class="ghostty-webgpu"><div aria-label="Terminal screen">check$</div></div></div>',
    '<div data-slot="tool-pane" aria-label="Terminal"><div class="ghostty-webgpu" style="width:0;height:0;overflow:hidden"><div aria-label="Terminal screen">check$</div></div></div>',
  ])('bounds the wait when no live terminal prompt renders (%s)', async (html) => {
  const page = await browser.newPage()
  try {
    await page.setContent(html)
    await expect(waitForTerminalPrompt(page, 'check$', 100)).rejects.toThrow('Timeout')
  } finally {
    await page.close()
  }
})

test.skipIf(!browserAvailable)(
  'waits for the accessibility mirror to receive the shell prompt',
  async () => {
    const page = await browser.newPage()
    try {
      await page.setContent(
        '<div data-slot="tool-pane" aria-label="Terminal"><div class="ghostty-webgpu"><div aria-label="Terminal screen"></div></div></div>',
      )
      const waiting = waitForTerminalPrompt(page, 'check$', 2_000)
      await page.evaluate(() => {
        requestAnimationFrame(() => {
          document.querySelector('[aria-label="Terminal screen"]').textContent = 'check$'
        })
      })
      expect(await waiting).toEqual({ count: 1, promptRendered: true })
    } finally {
      await page.close()
    }
  },
)
