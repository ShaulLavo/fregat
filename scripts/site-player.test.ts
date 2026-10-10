import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'

const site = path.resolve(import.meta.dirname, '../apps/site/src')
const player = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  await readFile(path.join(site, 'scripts/player.ts'), 'utf8'),
)
const unavailable = !existsSync(chromium.executablePath())
if (unavailable) console.info('Site playback tests require an installed Playwright Chromium.')

async function loadReplica({ page, name = 'agents' }: { page: Page; name?: 'agents' | 'review' }) {
  const markup = await readFile(path.join(site, `replicas/${name}.html`), 'utf8')
  await page.clock.install({ time: 0 })
  await page.clock.pauseAt(0)
  await page.setContent(
    `<div id="replica" data-replica style="margin-top:2000px;width:660px;height:500px">${markup}</div><button data-motion-for="replica">Pause</button>`,
  )
  await page.addScriptTag({ content: player })
  await page.locator('.rep.paused').waitFor()
  await page.locator('[data-replica]').evaluate((stage) => stage.scrollIntoView())
  await page.locator('.rep:not(.paused)').waitFor()
  return {
    rep: page.locator('.rep'),
    typed: page.locator('[data-type]').first(),
    control: page.locator('[data-motion-for]'),
    pressed: page.locator('.pressed'),
  }
}

describe.skipIf(unavailable)('site playback ownership', () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    browser = await chromium.launch()
  })
  afterAll(async () => {
    await browser?.close()
  })
  beforeEach(async () => {
    page = await browser.newPage({ viewport: { width: 900, height: 900 } })
  })
  afterEach(async () => {
    await page?.close()
  })

  test('a mid-type skip holds the complete final text', async () => {
    const { rep, typed, control } = await loadReplica({ page })
    await page.clock.runFor(900)
    expect(await typed.textContent()).toBe('c')
    await rep.dispatchEvent('pointerdown')
    expect(await typed.textContent()).toBe('claude auth login')
    expect(await control.textContent()).toBe('Replay')
    await page.clock.runFor(30)
    expect(await typed.textContent()).toBe('claude auth login')
    expect(await typed.evaluate((element) => element.classList.contains('caret'))).toBe(false)
    await page.clock.runFor(10_000)
    expect(await typed.textContent()).toBe('claude auth login')
  })

  test('replay starts a new typing run without old ticks', async () => {
    const { rep, typed, control } = await loadReplica({ page })
    await page.clock.runFor(900)
    await rep.dispatchEvent('pointerdown')
    await control.dispatchEvent('click')
    await page.clock.runFor(30)
    expect(await typed.textContent()).toBe('claude auth login')
    await page.clock.runFor(869)
    expect(await typed.textContent()).toBe('claude auth login')
    await page.clock.runFor(1)
    expect(await typed.textContent()).toBe('c')
    await page.clock.runFor(30)
    expect(await typed.textContent()).toBe('cl')
    await page.clock.runFor(570)
    expect(await typed.textContent()).toBe('claude auth login')
  })

  test.each([1200, 1920])(
    'skip at %dms clears pending and active pointer presses',
    async (time) => {
      const { rep, pressed } = await loadReplica({ page, name: 'review' })
      await page.clock.runFor(time)
      expect(await pressed.count()).toBe(time === 1920 ? 1 : 0)
      await rep.dispatchEvent('pointerdown')
      expect(await pressed.count()).toBe(0)
      expect(await page.locator('.pointer.press').count()).toBe(0)
      await page.clock.runFor(720)
      expect(await pressed.count()).toBe(0)
    },
  )

  test('an old pointer press cannot appear during replay', async () => {
    const { rep, control, pressed } = await loadReplica({ page, name: 'review' })
    await page.clock.runFor(1200)
    await rep.dispatchEvent('pointerdown')
    await control.dispatchEvent('click')
    await page.clock.runFor(720)
    expect(await pressed.count()).toBe(0)
    await page.clock.runFor(1200)
    expect(await pressed.count()).toBe(1)
    await page.clock.runFor(160)
    expect(await pressed.count()).toBe(0)
  })

  test('pause and resume preserve the typing position and timeline', async () => {
    const { typed, control } = await loadReplica({ page })
    await page.clock.runFor(900)
    await control.dispatchEvent('click')
    await page.clock.runFor(900)
    expect(await typed.textContent()).toBe('c')
    expect(await control.textContent()).toBe('Play')
    await control.dispatchEvent('click')
    await page.clock.runFor(30)
    expect(await typed.textContent()).toBe('cl')
    await page.clock.runFor(570)
    expect(await typed.textContent()).toBe('claude auth login')
  })

  test('off-screen playback resumes its unfinished typing', async () => {
    const { rep, typed } = await loadReplica({ page })
    await page.clock.runFor(900)
    await page.evaluate(() => scrollTo(0, 0))
    await page.locator('.rep.paused').waitFor()
    await page.clock.runFor(900)
    expect(await typed.textContent()).toBe('c')
    await rep.evaluate((element) => element.scrollIntoView())
    await page.locator('.rep:not(.paused)').waitFor()
    await page.clock.runFor(30)
    expect(await typed.textContent()).toBe('cl')
  })

  test('hidden-page playback resumes its unfinished typing', async () => {
    const { typed } = await loadReplica({ page })
    await page.clock.runFor(900)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.clock.runFor(900)
    expect(await typed.textContent()).toBe('c')
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.clock.runFor(30)
    expect(await typed.textContent()).toBe('cl')
  })

  test('reduced motion starts and stays on the complete final frame', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const markup = await readFile(path.join(site, 'replicas/agents.html'), 'utf8')
    await page.clock.install({ time: 0 })
    await page.clock.pauseAt(0)
    await page.setContent(
      `<div id="replica" data-replica>${markup}</div><button data-motion-for="replica">Pause</button>`,
    )
    await page.addScriptTag({ content: player })
    expect(await page.locator('.rep.settled').count()).toBe(1)
    expect(await page.locator('[data-motion-for]').isVisible()).toBe(false)
    await page.clock.runFor(10_000)
    expect(await page.locator('[data-type]').first().textContent()).toBe('claude auth login')
    expect(await page.locator('.caret, .pressed, .pointer.press').count()).toBe(0)
  })
})
