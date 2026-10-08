// Checks the landing page's focus ring, text contrast and replica motion controls in both color
// schemes. Usage: bun scripts/verify-a11y.ts [evidence-directory]  (after `bun astro build`)
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const evidence = process.argv[2]
if (evidence) await mkdir(evidence, { recursive: true })

const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(request) {
    const path = new URL(request.url).pathname.replace(/^\/fregat\//, '/')
    const file = Bun.file(join(dist, path.endsWith('/') ? `${path}index.html` : path))
    return (await file.exists()) ? new Response(file) : new Response(null, { status: 404 })
  },
})
const url = `http://127.0.0.1:${server.port}/fregat/`

// Readable text that sits on the page background, not on a plate.
const TEXT: readonly (readonly [string, string])[] = [
  ['.hero p', 'hero lead'],
  ['header nav a', 'header link'],
  ['.plate-cap span', 'plate caption'],
  ['.plate-cap button', 'plate control'],
  ['.sect .fine', 'section note'],
  ['.parts li p', 'part description'],
  ['.runit .fine', 'run prerequisites'],
  ['footer span', 'footer text'],
  ['footer nav a', 'footer link'],
]

// Resolves any CSS color (including oklch and color-mix) to sRGB through a canvas, then applies
// WCAG contrast against the first opaque background up the tree.
function contrast(page: Page, selector: string, property: 'color' | 'outlineColor') {
  return page
    .locator(selector)
    .first()
    .evaluate((element, key) => {
      const canvas = document
        .createElement('canvas')
        .getContext('2d', { willReadFrequently: true })!
      const rgba = (color: string) => {
        canvas.clearRect(0, 0, 1, 1)
        canvas.fillStyle = color
        canvas.fillRect(0, 0, 1, 1)
        return [...canvas.getImageData(0, 0, 1, 1).data]
      }
      const background = (start: Element | null): number[] => {
        for (let node = start; node; node = node.parentElement) {
          const value = rgba(getComputedStyle(node).backgroundColor)
          if (value[3] === 255) return value
        }
        return rgba(getComputedStyle(document.documentElement).backgroundColor)
      }
      const luminance = ([r, g, b]: number[]) =>
        [r!, g!, b!]
          .map((channel) => channel / 255)
          .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
          .reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index]!, 0)
      const parent = key === 'outlineColor' ? element.parentElement : element
      const [high, low] = [
        luminance(rgba(getComputedStyle(element)[key])),
        luminance(background(parent)),
      ].sort((a, b) => b - a)
      return (high! + 0.05) / (low! + 0.05)
    }, property)
}

// Tabs from the top of the page until the hero's motion control holds focus.
async function tabTo(page: Page, selector: string): Promise<void> {
  for (let presses = 0; presses < 40; presses++) {
    await page.keyboard.press('Tab')
    if (await page.locator(selector).evaluate((element) => element === document.activeElement)) {
      return
    }
  }
  assert.fail(`Tab never reached ${selector}`)
}

function replicaAnimations(page: Page, id: string) {
  return page.locator(`#${id} .rep`).evaluate((rep) =>
    rep
      .getAnimations({ subtree: true })
      .filter((animation) => animation instanceof CSSAnimation)
      .map((animation) => animation.playState),
  )
}

const browser = await chromium.launch()
const failures: string[] = []
const report = (line: string, ok: boolean) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`)
  if (!ok) failures.push(line)
}
try {
  for (const colorScheme of ['light', 'dark'] as const) {
    const page = await browser.newPage({ colorScheme, viewport: { width: 1440, height: 900 } })
    await page.goto(url)
    await page.evaluate(() => document.fonts.ready)

    for (const [selector, name] of TEXT) {
      const ratio = await contrast(page, selector, 'color')
      report(`${colorScheme} ${name}: ${ratio.toFixed(2)}:1 (minimum 4.5:1)`, ratio >= 4.5)
    }

    const control = '[data-motion-for="hero"]'
    await tabTo(page, control)
    const ring = await page.locator(control).evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        visible: element.matches(':focus-visible'),
        style: style.outlineStyle,
        width: parseFloat(style.outlineWidth),
      }
    })
    report(
      `${colorScheme} focus ring: ${ring.style} ${ring.width}px, focus-visible ${ring.visible}`,
      ring.visible && ring.style !== 'none' && ring.width >= 2,
    )
    const ringRatio = await contrast(page, control, 'outlineColor')
    report(
      `${colorScheme} focus ring contrast: ${ringRatio.toFixed(2)}:1 (minimum 3:1)`,
      ringRatio >= 3,
    )
    if (evidence) {
      const box = (await page.locator('figure .plate-cap').boundingBox())!
      await page.screenshot({
        path: join(evidence, `focus-${colorScheme}.png`),
        clip: { x: box.x + box.width - 320, y: box.y - 12, width: 340, height: box.height + 24 },
      })
    }

    await page.keyboard.press('Enter')
    const shown = () => page.locator('#hero .rep .in').count()
    const before = await shown()
    await page.waitForTimeout(2500)
    report(`${colorScheme} a paused story stays on its step`, (await shown()) === before)
    const paused = await replicaAnimations(page, 'hero')
    const label = await page.locator(control).textContent()
    report(
      `${colorScheme} Enter pauses the hero: label "${label}", ${paused.length} animations ${[...new Set(paused)].join(',')}`,
      label === 'Play' && paused.every((state) => state !== 'running'),
    )
    await page.keyboard.press('Enter')
    report(
      `${colorScheme} Enter resumes the hero`,
      (await page.locator(control).textContent()) === 'Pause',
    )

    await page.locator('#hero .rep').dispatchEvent('pointerdown')
    const ended = await replicaAnimations(page, 'hero')
    const endedLabel = await page.locator(control).textContent()
    report(
      `${colorScheme} an ended hero holds still: label "${endedLabel}", ${ended.length} animations`,
      endedLabel === 'Replay' && ended.length === 0,
    )
    await page.close()
  }

  const page = await browser.newPage({
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 844 },
  })
  await page.goto(url)
  for (const id of ['hero', 's-review', 's-update', 's-undo', 's-agents']) {
    const settled = await page
      .locator(`#${id} .rep`)
      .evaluate((rep) => rep.classList.contains('settled'))
    const animations = await replicaAnimations(page, id)
    const hidden = await page.locator(`[data-motion-for="${id}"]`).isHidden()
    report(
      `reduced motion ${id}: final frame ${settled}, ${animations.length} animations, control hidden ${hidden}`,
      settled && animations.length === 0 && hidden,
    )
  }
  await page.close()
} finally {
  await browser.close()
  server.stop()
}
assert.deepEqual(failures, [], 'Every focus, contrast and motion check passes')
