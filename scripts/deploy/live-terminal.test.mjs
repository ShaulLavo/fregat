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

async function terminalFixture(page, options = {}) {
  const {
    backend = 'canvas',
    background = 'white',
    canvasStyle = '',
    textStyle = '',
    paintEcho = true,
    hostStyle = '',
    paneStyle = '',
    paint = true,
    cursorOnly = false,
    cursor = false,
    outsideChange = false,
    animatedBackground = false,
    inputBackground = false,
    restoreChange = false,
  } = options
  await page.setContent(
    `<style>@keyframes wall{0%,40%{background:white}50%,90%{background:black}100%{background:white}}.wall{position:absolute;inset:0;animation:wall 300ms linear infinite}</style><body style="margin:0"><div data-slot="tool-pane" aria-label="Terminal" style="${paneStyle}"><div class="ghostty-webgpu" style="position:relative;width:600px;height:90px;background:${background};${hostStyle}">${animatedBackground ? '<div class="wall" aria-hidden="true"></div>' : ''}<canvas class="ghostty-webgpu-canvas" width="600" height="90" style="width:600px;height:90px;${backend === 'dom' ? 'opacity:0;' : ''}${canvasStyle}"></canvas>${backend === 'dom' ? `<div style="position:absolute;top:0;width:600px;white-space:pre;font:20px/30px monospace"><div data-row="0"><span style="${textStyle}">check$ </span></div></div>` : ''}<textarea aria-label="Terminal input" style="position:absolute;left:84px;top:0;width:1px;height:1px;opacity:0"></textarea><div aria-label="Terminal screen" style="position:absolute;left:-10000px"><div>check$</div><div> </div><div> </div></div></div></div></body>`,
  )
  await page.evaluate(
    ({
      backend,
      paintEcho,
      paint: painted,
      cursorOnly,
      cursor,
      outsideChange,
      inputBackground,
      restoreChange,
    }) => {
      const input = document.querySelector('textarea')
      const canvas = document.querySelector('canvas')
      const mirror = document.querySelector('[aria-label="Terminal screen"]')
      const span = document.querySelector('[data-row] span')
      const context = canvas.getContext('2d')
      const outside = document.createElement('div')
      outside.style.cssText = 'position:absolute;left:0;top:120px;font:20px monospace'
      document.body.append(outside)
      let value = ''
      window.terminalInput = { erased: 0, entered: 0, typed: '' }
      const paint = () => {
        mirror.firstElementChild.textContent = `check$ ${value}`.trimEnd()
        input.style.left = `${84 + value.length * 12}px`
        if (inputBackground) canvas.parentElement.style.background = value ? 'black' : 'white'
        if (!painted || (!paintEcho && value && !cursorOnly)) return
        if (backend === 'dom') {
          span.textContent = `check$ ${value}`
          return
        }
        context.clearRect(0, 0, 600, 90)
        context.font = '20px monospace'
        context.fillStyle = 'black'
        context.fillText(`check$ ${paintEcho ? value : ''}`, 0, 22)
        if (cursorOnly || cursor) context.fillRect(84 + value.length * 12, 0, 12, 30)
        if (restoreChange && window.terminalInput.erased) context.fillRect(84, 0, 60, 30)
      }
      input.addEventListener('keydown', (event) => {
        if (event.ctrlKey && event.key === 'u') {
          event.preventDefault()
          value = ''
          window.terminalInput.erased++
          paint()
          return
        }
        if (event.key === 'Enter') window.terminalInput.entered++
        if (event.ctrlKey || event.key.length !== 1) return
        value += event.key
        window.terminalInput.typed += event.key
        paint()
        if (outsideChange) outside.textContent = `Changed outside: ${value}`
      })
      paint()
    },
    {
      backend,
      paintEcho,
      paint,
      cursorOnly,
      cursor,
      outsideChange,
      inputBackground,
      restoreChange,
    },
  )
}

// Browser fixtures skip when a fresh contributor checkout has no Playwright browser.
test
  .skipIf(!browserAvailable)
  .each([
    '',
    '<div data-slot="tool-pane" aria-label="Terminal"><div class="ghostty-webgpu"><div aria-label="Terminal screen">check$</div></div></div>',
    '<div data-slot="tool-pane" aria-label="Terminal"><div class="ghostty-webgpu"><canvas></canvas></div></div>',
    '<div hidden data-slot="tool-pane" aria-label="Terminal"><div class="ghostty-webgpu"><div aria-label="Terminal screen">check$</div></div></div>',
    '<div aria-label="Terminal screen">check$</div>',
  ])('bounds the wait when a live terminal structure is absent (%s)', async (html) => {
  const page = await browser.newPage()
  try {
    await page.setContent(html)
    await expect(waitForTerminalPrompt(page, 'check$', 100)).rejects.toThrow('Timeout')
  } finally {
    await page.close()
  }
})

test.skipIf(!browserAvailable).each([
  ['compounded transparency', { hostStyle: 'opacity:0.1', canvasStyle: 'opacity:0.1' }],
  ['blank canvas', { paint: false }],
  ['transparent canvas', { canvasStyle: 'opacity:0' }],
  ['hidden canvas', { canvasStyle: 'visibility:hidden' }],
  ['unmounted canvas', { canvasStyle: 'display:none' }],
  ['offscreen canvas', { canvasStyle: 'position:absolute;left:10000px' }],
  ['transparent host', { hostStyle: 'opacity:0' }],
  ['hidden host', { hostStyle: 'visibility:hidden' }],
  ['transparent ancestor', { paneStyle: 'opacity:0' }],
  ['clipped host', { hostStyle: 'width:0;height:0;overflow:hidden' }],
])('bounds the wait for a %s', async (_name, options) => {
  const page = await browser.newPage()
  try {
    await terminalFixture(page, options)
    await expect(waitForTerminalPrompt(page, 'check$', 500)).rejects.toThrow('Timeout')
  } finally {
    await page.close()
  }
})

test.skipIf(!browserAvailable)(
  'waits for the accessibility mirror to receive the shell prompt',
  async () => {
    const page = await browser.newPage()
    try {
      await terminalFixture(page)
      await page.evaluate(() => {
        document.querySelector('[aria-label="Terminal screen"]').firstElementChild.textContent = ''
      })
      const waiting = waitForTerminalPrompt(page, 'check$', 2_000)
      await page.evaluate(() => {
        requestAnimationFrame(() => {
          document.querySelector('[aria-label="Terminal screen"]').firstElementChild.textContent =
            'check$'
        })
      })
      expect(await waiting).toEqual({ count: 1, promptRendered: true })
      expect(await page.evaluate(() => window.terminalInput)).toEqual({
        typed: ' xyz',
        erased: 1,
        entered: 0,
      })
    } finally {
      await page.close()
    }
  },
)

test.skipIf(!browserAvailable)(
  'accepts the visible DOM renderer while its pointer canvas is transparent',
  async () => {
    const page = await browser.newPage()
    try {
      await terminalFixture(page, { backend: 'dom' })
      expect(await waitForTerminalPrompt(page, 'check$', 2_000)).toEqual({
        count: 1,
        promptRendered: true,
      })
      expect(await page.evaluate(() => window.terminalInput)).toEqual({
        typed: ' xyz',
        erased: 1,
        entered: 0,
      })
    } finally {
      await page.close()
    }
  },
)

test
  .skipIf(!browserAvailable)
  .each([
    'color:transparent',
    '-webkit-text-fill-color:transparent',
    'color:white;background:white',
    'opacity:0.01',
  ])('rejects unpainted DOM prompt glyphs with %s', async (textStyle) => {
  const page = await browser.newPage()
  try {
    await terminalFixture(page, { backend: 'dom', textStyle })
    await expect(waitForTerminalPrompt(page, 'check$', 500)).rejects.toThrow('Timeout')
    expect(await page.evaluate(() => window.terminalInput)).toEqual({
      typed: ' xyz',
      erased: 1,
      entered: 0,
    })
  } finally {
    await page.close()
  }
})

test.skipIf(!browserAvailable).each(['canvas', 'dom'])(
  'accepts the painted %s prompt over a gradient',
  async (backend) => {
    const page = await browser.newPage()
    try {
      await terminalFixture(page, { backend, background: 'linear-gradient(90deg,white,black)' })
      expect(await waitForTerminalPrompt(page, 'check$', 2_000)).toEqual({
        count: 1,
        promptRendered: true,
      })
      expect(await page.evaluate(() => window.terminalInput)).toEqual({
        typed: ' xyz',
        erased: 1,
        entered: 0,
      })
    } finally {
      await page.close()
    }
  },
)

test.skipIf(!browserAvailable).each(['canvas', 'dom'])(
  'rejects the gradient behind an invisible %s prompt',
  async (backend) => {
    const page = await browser.newPage()
    try {
      await terminalFixture(page, {
        backend,
        background: 'linear-gradient(90deg,white,black)',
        canvasStyle: 'opacity:0',
        textStyle: 'color:transparent;-webkit-text-fill-color:transparent',
      })
      await expect(waitForTerminalPrompt(page, 'check$', 500)).rejects.toThrow('Timeout')
      expect(await page.evaluate(() => window.terminalInput)).toEqual({
        typed: ' xyz',
        erased: 1,
        entered: 0,
      })
    } finally {
      await page.close()
    }
  },
)

test.skipIf(!browserAvailable).each([
  ['an animated background', { animatedBackground: true }],
  ['a reversible full-cell background fill', { inputBackground: true }],
])('rejects %s behind invisible glyphs', async (_name, options) => {
  const page = await browser.newPage()
  try {
    await terminalFixture(page, {
      ...options,
      canvasStyle: 'opacity:0',
      textStyle: 'color:transparent;-webkit-text-fill-color:transparent',
    })
    await expect(waitForTerminalPrompt(page, 'check$', 2_000)).rejects.toThrow('Timeout')
    expect(await page.evaluate(() => window.terminalInput)).toEqual({
      typed: ' xyz',
      erased: 1,
      entered: 0,
    })
  } finally {
    await page.close()
  }
})

test.skipIf(!browserAvailable)(
  'rejects marker cells that remain changed after Ctrl-U',
  async () => {
    const page = await browser.newPage()
    try {
      await terminalFixture(page, { restoreChange: true })
      await expect(waitForTerminalPrompt(page, 'check$', 2_000)).rejects.toThrow(
        'Timeout restoring the terminal input pixels.',
      )
      expect(await page.evaluate(() => window.terminalInput)).toEqual({
        typed: ' xyz',
        erased: 1,
        entered: 0,
      })
    } finally {
      await page.close()
    }
  },
)

test.skipIf(!browserAvailable)('accepts restored glyphs with a stable block cursor', async () => {
  const page = await browser.newPage()
  try {
    await terminalFixture(page, { cursor: true })
    expect(await waitForTerminalPrompt(page, 'check$', 2_000)).toEqual({
      count: 1,
      promptRendered: true,
    })
  } finally {
    await page.close()
  }
})

test.skipIf(!browserAvailable).each([
  ['stalled glyphs', { paintEcho: false }],
  ['cursor movement alone', { paintEcho: false, cursorOnly: true }],
  ['changes outside the terminal bounds', { paintEcho: false, outsideChange: true }],
])('rejects %s and erases the input after failure', async (_name, options) => {
  const page = await browser.newPage()
  try {
    await terminalFixture(page, options)
    await expect(waitForTerminalPrompt(page, 'check$', 500)).rejects.toThrow('Timeout')
    expect(await page.evaluate(() => window.terminalInput)).toEqual({
      typed: ' xyz',
      erased: 1,
      entered: 0,
    })
    expect(await page.locator('[aria-label="Terminal screen"]').textContent()).not.toContain('xyz')
  } finally {
    await page.close()
  }
})
