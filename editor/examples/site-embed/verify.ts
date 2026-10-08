import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const base = process.argv[2]
const output = path.resolve(process.argv[3])
assert(base && output, 'Provide a static URL and evidence directory')
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
const results = []
for (const direction of ['a', 'b', 'c']) {
  for (const [name, width, height] of [
    ['desktop', 1440, 900],
    ['mobile', 390, 844],
  ] as const) {
    const context = await browser.newContext({
      viewport: { width, height: 180 },
      colorScheme: direction === 'b' ? 'dark' : 'light',
    })
    const page = await context.newPage()
    const errors: string[] = []
    const resources: { url: string; stage: string; gzip: number; bytes: number }[] = []
    const pending: Promise<void>[] = []
    let stage = 'initial'
    context.on('response', (response) => {
      const at = stage
      pending.push(
        response
          .body()
          .then((body) => {
            resources.push({
              url: response.url(),
              stage: at,
              gzip: gzipSync(body).length,
              bytes: body.length,
            })
          })
          .catch(() => {}),
      )
    })
    page.on('pageerror', (error) => errors.push(String(error)))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    try {
      await page.goto(`${base}/${direction}/`, { waitUntil: 'networkidle' })
      assert(
        !resources.some((entry) => entry.url.endsWith('/embed/editor.js')),
        'Editor stays unloaded above the demo',
      )
      const host = page.locator('.sg-editor').first()
      stage = 'scroll'
      await page.setViewportSize({ width, height })
      await host.scrollIntoViewIfNeeded()
      await page.waitForFunction(
        () => document.querySelector<HTMLElement>('.sg-editor')?.dataset.embed === 'ready',
      )
      await page.waitForFunction(() =>
        [...CSS.highlights].some(([key, value]) => !key.startsWith('sg-') && value.size > 0),
      )
      await page.waitForTimeout(800)
      assert(
        !resources.some((entry) => /typescriptLsp\.worker/.test(entry.url)),
        'TypeScript worker stays unloaded until interaction',
      )
      const interactiveMs = await host.getAttribute('data-interactive-ms')
      const initialLines = Number(await host.getAttribute('data-lines'))
      await page.screenshot({ path: path.join(output, direction, `${name}.png`), fullPage: true })
      stage = 'typescript'
      await host.locator('[role=textbox]').focus()
      await page.keyboard.press('Control+Home')
      await page.keyboard.type('// Edited in Singapore')
      await page.keyboard.press('Enter')
      await page.waitForFunction(
        () => document.querySelector<HTMLElement>('.sg-editor')?.dataset.typescript === 'ready',
        undefined,
        { timeout: 60_000 },
      )
      await page.waitForFunction(
        (count) => Number(document.querySelector<HTMLElement>('.sg-editor')?.dataset.lines) > count,
        initialLines,
      )
      assert(
        (await host.textContent())?.includes('Edited in Singapore'),
        'Typing changed the real editor rows',
      )
      await page.waitForTimeout(800)
      const hoverPoint = await host.evaluate((element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) {
          const node = walker.currentNode
          const at = node.textContent?.indexOf('createPieceTableSnapshot(') ?? -1
          if (at < 0) continue
          const range = document.createRange()
          range.setStart(node, at + 4)
          range.setEnd(node, at + 8)
          const box = range.getBoundingClientRect()
          if (box.width && box.top >= 0 && box.top < window.innerHeight)
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        }
        return null
      })
      assert(hoverPoint, 'A real function token is visible for hover')
      await page.mouse.move(hoverPoint.x, hoverPoint.y)
      await page.waitForTimeout(1500)
      const tooltip = await page.locator('[role=dialog][class*=-hover]').allTextContents()
      assert(
        tooltip.some((text) => text.includes('createPieceTableSnapshot')),
        'Real TypeScript hover shows the function signature',
      )
      await page.screenshot({ path: path.join(output, direction, `${name}-hover.png`) })
      const workerRequested = resources.some((entry) => /typescriptLsp\.worker/.test(entry.url))
      assert(workerRequested, 'First edit loaded the TypeScript worker')
      if (direction === 'c') {
        const scrub = page.locator('#scrub')
        const latest = await scrub.getAttribute('max')
        assert(Number(latest) > 0, 'Typing created real retained history states')
        await scrub.evaluate((element) => {
          ;(element as HTMLInputElement).value = '0'
          element.dispatchEvent(new Event('input', { bubbles: true }))
        })
        await page.waitForFunction(
          () => !document.querySelector('.sg-editor')?.textContent?.includes('Edited in Singapore'),
        )
        await scrub.evaluate((element, value) => {
          ;(element as HTMLInputElement).value = value ?? '0'
          element.dispatchEvent(new Event('input', { bubbles: true }))
        }, latest)
        await page.waitForFunction(() =>
          document.querySelector('.sg-editor')?.textContent?.includes('Edited in Singapore'),
        )
      }
      if (direction === 'b') {
        await page.locator('[role=tab][data-file="1"]').click()
        await page.waitForFunction(() =>
          document.querySelector('.sg-editor')?.textContent?.includes('new Editor'),
        )
        await page.locator('[role=tab][data-file="0"]').click()
        await page.waitForFunction(() =>
          document.querySelector('.sg-editor')?.textContent?.includes('createPieceTableSnapshot'),
        )
      }
      stage = 'million'
      await page.locator('#million').click()
      await page.waitForFunction(
        () => document.querySelector<HTMLElement>('.sg-editor')?.dataset.lines === '1000000',
        undefined,
        { timeout: 60_000 },
      )
      await host.locator('[role=textbox]').focus()
      await page.keyboard.press('Control+End')
      await page.waitForTimeout(300)
      assert(
        (await host.textContent())?.includes('line1000000'),
        'The millionth line is in the real editor',
      )
      await page.keyboard.press('End')
      await page.keyboard.type(' // edited')
      await page.waitForTimeout(100)
      assert(
        (await host.textContent())?.includes('// edited'),
        'The million-line document is editable',
      )
      const painted = await host.locator('[data-editor-virtual-row="999999"]').evaluate((row) => {
        const box = row.getBoundingClientRect()
        const hit = document.elementFromPoint(box.left + 8, box.top + box.height / 2)
        return hit === row || row.contains(hit)
      })
      assert(painted, 'The millionth line paints and receives pointer hits')
      await page.screenshot({ path: path.join(output, direction, `${name}-million.png`) })
      await Promise.all(pending)
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
        0,
        'No page horizontal overflow',
      )
      assert.deepEqual(errors, [], 'No page or console errors')
      const bytes = Object.fromEntries(
        ['initial', 'scroll', 'typescript', 'million'].map((value) => [
          value,
          resources
            .filter((entry) => entry.stage === value)
            .reduce((sum, entry) => sum + entry.gzip, 0),
        ]),
      )
      const result = {
        direction,
        viewport: name,
        interactiveMs: Number(interactiveMs),
        gzipBytes: bytes,
        workerRequested,
        hover: tooltip,
        resources,
        errors,
      }
      results.push(result)
      console.log(
        JSON.stringify({
          direction,
          viewport: name,
          interactiveMs: result.interactiveMs,
          gzipBytes: bytes,
          hover: true,
          millionEditable: true,
        }),
      )
      await context.close()
    } catch (error) {
      await page
        .screenshot({ path: path.join(output, direction, `${name}-failure.png`) })
        .catch(() => {})
      await writeFile(
        path.join(output, direction, `${name}-failure.json`),
        JSON.stringify(
          {
            error: String(error),
            errors,
            resources,
            html: await hostContent(page).catch(() => ''),
            url: page.url(),
          },
          null,
          2,
        ),
      )
      await browser.close()
      throw error
    }
  }
}
const standalone = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const standalonePage = await standalone.newPage()
const standaloneErrors: string[] = []
standalonePage.on('pageerror', (error) => standaloneErrors.push(String(error)))
await standalonePage.goto(`${base}/embed/`, { waitUntil: 'networkidle' })
await standalonePage.waitForFunction(
  () => document.querySelector<HTMLElement>('.sg-editor')?.dataset.embed === 'ready',
)
assert.equal(
  await standalonePage.evaluate(() => typeof (window as unknown as { SG?: unknown }).SG),
  'undefined',
  'Standalone embed needs no replica',
)
assert.notEqual(
  await standalonePage.locator('.sg-editor').getAttribute('data-typescript'),
  'ready',
  'Cold hover starts with TypeScript unloaded',
)
const token = standalonePage
  .locator('[data-editor-virtual-row]')
  .filter({ hasText: 'const original =' })
const box = await token.boundingBox()
assert(box, 'Standalone sample function is visible')
await standalonePage.mouse.move(box.x + 21 * 7.8, box.y + box.height / 2)
await standalonePage.waitForFunction(
  () => document.querySelector<HTMLElement>('.sg-editor')?.dataset.typescript === 'ready',
  undefined,
  { timeout: 60_000 },
)
assert.deepEqual(standaloneErrors, [], 'Standalone and cold-hover loading have no page errors')
await standalone.close()
await writeFile(
  path.join(output, 'embed-measurements.json'),
  JSON.stringify(
    {
      experiment: true,
      standalone: true,
      coldHoverLoadsTypeScript: true,
      date: new Date().toISOString(),
      machine: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0].model },
      browser: browser.version(),
      results,
    },
    null,
    2,
  ),
)
await browser.close()

async function hostContent(page: import('@playwright/test').Page) {
  return page
    .locator('.sg-editor')
    .first()
    .evaluate((element) => element.outerHTML)
}
