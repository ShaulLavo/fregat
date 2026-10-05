import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { expect, test } from 'vitest'
import { launchBrowser } from './browser-launch'
import { chromiumUnavailable } from './browser-prerequisites'
import type { Evidence } from './evidence'
import { captureScenarioFailure } from './scenario-failure'

async function withCaptureFixture(body: (page: Page, evidence: Evidence) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'fregat-failure-capture-'))
  const browser = await launchBrowser('chromium', false)
  const file = (name: string) => join(dir, name)
  const write = async (name: string, content: string | Uint8Array) => {
    await writeFile(file(name), content)
    return file(name)
  }
  const evidence: Evidence = {
    dir,
    startedAt: new Date(),
    file,
    write,
    json: (name, value) => write(name, JSON.stringify(value)),
  }
  try {
    const page = await browser.newPage()
    await page.route('http://failure-capture.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<h1>${new URL(route.request().url()).pathname.slice(1)}</h1>`,
      }),
    )
    await body(page, evidence)
  } finally {
    await browser.close()
    await rm(dir, { recursive: true, force: true })
  }
}

async function rejectWithCapture(
  page: Page,
  evidence: Evidence,
  original: unknown,
  cleanup?: () => Promise<void>,
) {
  try {
    throw original
  } catch (error) {
    await captureScenarioFailure(page, evidence, 'before-cleanup')
    throw error
  } finally {
    await cleanup?.()
  }
}

test.skipIf(chromiumUnavailable)(
  'a known-good page produces a labelled PNG and metadata',
  async () => {
    await withCaptureFixture(async (page, evidence) => {
      await page.goto('http://failure-capture.test/known-good')
      const capture = await captureScenarioFailure(page, evidence, 'after-scenario')
      expect(capture).toMatchObject({
        phase: 'after-scenario',
        urlBefore: page.url(),
        urlAfter: page.url(),
        screenshot: { status: 'captured', file: 'failure-after-scenario.png' },
      })
      expect(await readFile(evidence.file('failure-after-scenario.json'), 'utf8')).toBe(
        JSON.stringify(capture),
      )
      const png = await readFile(evidence.file('failure-after-scenario.png'))
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    })
  },
)

test.skipIf(chromiumUnavailable)(
  'a capture in the body catch precedes finally navigation',
  async () => {
    await withCaptureFixture(async (page, evidence) => {
      const original = new TypeError('controlled scenario failure')
      await page.goto('http://failure-capture.test/failed-state')
      await expect(
        rejectWithCapture(page, evidence, original, async () => {
          await page.goto('http://failure-capture.test/restored-page')
        }),
      ).rejects.toBe(original)
      const after = await captureScenarioFailure(page, evidence, 'after-scenario')
      const before = JSON.parse(
        await readFile(evidence.file('failure-before-cleanup.json'), 'utf8'),
      )
      expect(before).toMatchObject({
        phase: 'before-cleanup',
        urlBefore: 'http://failure-capture.test/failed-state',
        urlAfter: 'http://failure-capture.test/failed-state',
        screenshot: { status: 'captured', file: 'failure-before-cleanup.png' },
      })
      expect(after.urlBefore).toBe('http://failure-capture.test/restored-page')
      expect(after.urlAfter).toBe('http://failure-capture.test/restored-page')
      expect(await readFile(evidence.file('failure-before-cleanup.png'))).not.toEqual(
        await readFile(evidence.file('failure-after-scenario.png')),
      )
    })
  },
)

test.skipIf(chromiumUnavailable)(
  'a closed page records capture failure and preserves the thrown value',
  async () => {
    await withCaptureFixture(async (page, evidence) => {
      await page.goto('http://failure-capture.test/known-good')
      await page.close()
      const original = { code: 'original-scenario-failure' }
      await expect(rejectWithCapture(page, evidence, original)).rejects.toBe(original)
      const capture = JSON.parse(
        await readFile(evidence.file('failure-before-cleanup.json'), 'utf8'),
      )
      expect(capture.screenshot).toMatchObject({ status: 'failed', error: expect.any(String) })
    })
  },
)

test.skipIf(chromiumUnavailable)(
  'failed screenshot and metadata writes preserve the original error',
  async () => {
    await withCaptureFixture(async (page, evidence) => {
      await page.goto('http://failure-capture.test/known-good')
      const blocked = evidence.file('blocked')
      await writeFile(blocked, 'regular file')
      const unavailable: Evidence = {
        ...evidence,
        file: (name) => join(blocked, name),
        json: async (name, value) => {
          const target = join(blocked, name)
          await writeFile(target, JSON.stringify(value))
          return target
        },
      }
      const original = new TypeError('original assertion failure')
      await expect(rejectWithCapture(page, unavailable, original)).rejects.toBe(original)
    })
  },
)
