import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium } from '@playwright/test'
import { build } from 'vite'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, extname } from 'node:path'
import { installInputWorkerProof } from '../input-worker-proof.mjs'
import { runSample, withInputSessionCleanup, waitForConsumerSource } from '../input-scenarios.mjs'
import { inputMemory } from '../input-runtime.mjs'
import { validateWarmInputLifecycle } from '../input-results.mjs'
import { fixtureFacts } from '../src/fixtures.ts'
import { createHash } from 'node:crypto'
import { captureInputView } from '../input-capture.mjs'

let browser
let directory
const fixtures = {
  ordinary: 'export const value = 1;\n'.repeat(32),
  'short-lines': '//same source identity\n'.repeat(32),
}
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'input-buffer-identity-'))
  await build({
    root: resolve(import.meta.dirname, '..'),
    configFile: false,
    logLevel: 'silent',
    worker: { format: 'es' },
    build: { outDir: directory, emptyOutDir: true },
  })
  browser = await chromium.launch({ headless: true })
}, 20000)
afterAll(async () => {
  await browser?.close()
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('clipped capture preserves the complete native view pixels without scrolling', async () => {
  const { context, page } = await inputSession()
  try {
    await page.evaluate(() =>
      __stress.warmInputSubject('ordinary', 1, false, true, false, 'native'),
    )
    await page.waitForFunction(() => __stress.observe().state.initialHighlightStatus === 'painted')
    await page.locator('#view-0').evaluate((host) => {
      host.style.left = '0.5px'
      host.style.top = '0.5px'
    })
    const position = await page.evaluate(() => ({ x: scrollX, y: scrollY }))
    const original = await page.locator('#view-0').screenshot({ animations: 'disabled' })
    expect(await captureInputView(page)).toEqual(original)
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(position)
    await page.locator('#view-0').evaluate((host) => (host.style.left = '-100px'))
    await expect(captureInputView(page)).rejects.toThrow('complete view inside the viewport')
  } finally {
    await page.evaluate(() => __stress.dispose())
    await context.close()
  }
}, 20000)

test.each(['ordinary', 'short-lines'])(
  'replacement into %s gets its own observed source identity',
  async (next) => {
    const { context, page } = await inputSession()
    try {
      await page.evaluate(() =>
        __stress.warmInputSubject('ordinary', 1, false, true, false, 'platform'),
      )
      const known = await page.evaluate(() => __stress.settleConsumers())
      expect(known.sessions).toHaveLength(2)
      expect(known.minimaps).toHaveLength(1)
      expect(known.sessions.every((s) => s.current && s.answered)).toBe(true)
      expect(known.minimaps.every((m) => m.current && m.renderedAfterSource)).toBe(true)
      await page.evaluate(
        (next) => __stress.warmInputSubject(next, 1, false, true, false, 'platform'),
        next,
      )
      const replaced = await page.evaluate(() => __stress.settleConsumers())
      expect(replaced.sessions).toHaveLength(2)
      expect(replaced.minimaps).toHaveLength(1)
      expect(replaced.sessions.every((s) => s.current && s.answered)).toBe(true)
      expect(replaced.minimaps.every((m) => m.current && m.renderedAfterSource)).toBe(true)
    } finally {
      await page.evaluate(() => __stress.dispose())
      await context.close()
    }
  },
  20000,
)

test('actual canonical dormant reset passes complete warm lifecycle validation', async () => {
  const session = await inputSession()
  const fixture = {
    id: 'ordinary',
    ...fixtureFacts(fixtures.ordinary),
    sha256: createHash('sha256').update(fixtures.ordinary).digest('hex'),
  }
  const result = {
    manifest: { seed: 60061, fixtures: [fixture] },
    config: {
      consumers: 'platform',
      isolation: 'closed-browser-context-per-configuration',
      readiness: 'receipt-poll',
      diagnostics: false,
      fixtures: 'frozen-hashed-files',
      warmups: 1,
      warmupFixture: 'measured',
      operationsPerSample: { typing: 24 },
    },
    samples: [],
    warmupResets: [],
    startup: [],
  }
  let warmup
  let transition
  await withInputSessionCleanup(
    { candidate: session },
    { candidate: result },
    inputMemory,
    async () => {
      result.bootstrap = await runSample(
        session,
        fixture,
        'single',
        'typing',
        -1,
        {
          ...result,
          config: {
            ...result.config,
            isolation: 'closed-browser-context-per-fixture-view-scenario',
          },
        },
        inputMemory,
      )
      session.retainedInput = { beforeMemory: await inputMemory(session.cdp) }
      const start = performance.now()
      const facts = await session.page.evaluate(() =>
        __stress.warmInputSubject('ordinary', 60061, false, true, true, 'platform'),
      )
      session.retainedInput.facts = facts
      result.startup.push({
        fixture: 'ordinary',
        views: 'multiple',
        retained: facts.retained,
        ownerIdentity: facts.ownerIdentity,
        milliseconds: performance.now() - start,
      })
      warmup = await runSample(session, fixture, 'multiple', 'typing', -1, result, inputMemory)
      result.warmupResets.push({
        fixture: 'ordinary',
        views: 'multiple',
        scenario: 'typing',
        repetition: -1,
        cleanup: null,
        reset: warmup.reset,
      })
      const beforeImage = await session.page.locator('#view-2 canvas').first().screenshot()
      await session.page.evaluate(() => __stress.resetInput())
      const hidden = await readTransition(session.page)
      await session.page.evaluate(() => __stress.probeViews())
      const changed = await readTransition(session.page)
      await session.page.evaluate(() => __stress.revealHidden())
      const revealed = await readTransition(session.page)
      const afterImage = await session.page.locator('#view-2 canvas').first().screenshot()
      transition = { hidden, changed, revealed, changedPixels: !beforeImage.equals(afterImage) }
      await session.page.evaluate(() => __stress.finishProbe())
      result.samples.push(
        await runSample(session, fixture, 'multiple', 'typing', 0, result, inputMemory),
      )
    },
  )
  const opened = warmup.observation.consumers.opened
  const dormant = opened.minimaps.find((receipt) => receipt.viewId === 'view-2')
  console.info(
    JSON.stringify({
      kind: 'actual-warm-reset-probe',
      reset: warmup.reset,
      source: opened.minimaps.map(
        ({ viewId, protocol, current, dormant, renderedAfterSource }) => ({
          viewId,
          protocol,
          current,
          dormant,
          renderedAfterSource,
        }),
      ),
      views: opened.views.map(({ visible }) => visible),
      subsequentViews: result.samples[0].observation.consumers.opened.views.map(
        ({ visible }) => visible,
      ),
      transition,
      cleanup: result.cleanup,
    }),
  )
  expect(
    opened.minimaps
      .filter((receipt) => receipt.viewId !== 'view-2')
      .every((receipt) => receipt.current && receipt.renderedAfterSource),
  ).toBe(true)
  expect(dormant).toMatchObject({
    protocol: 'canonical',
    current: false,
    dormant: true,
    renderedAfterSource: false,
  })
  expect(opened.views[2].visible).toBe(false)
  expect(warmup.reset.sourceCurrent).toBe(true)
  expect(result.samples[0].observation.consumers.opened.views[2].visible).toBe(false)
  expect(transition.hidden.visible).toBe(false)
  expect(transition.changed.visible).toBe(false)
  expect(transition.changed.worker.sourceUpdates).toBe(transition.hidden.worker.sourceUpdates)
  expect(transition.changed.worker.latestRender).toBe(transition.hidden.worker.latestRender)
  expect(transition.changed.receipt).toMatchObject({ current: false, dormant: true })
  expect(transition.changed.worker).toMatchObject({
    pendingSourceRequests: 0,
    pendingRenderRequests: 0,
    failedResponses: 0,
    staleResponses: 0,
  })
  expect(transition.revealed.visible).toBe(true)
  expect(transition.revealed.receipt).toMatchObject({
    current: true,
    dormant: false,
    renderedAfterSource: true,
  })
  expect(transition.revealed.receipt.sourcePoint).not.toEqual(
    transition.changed.receipt.sourcePoint,
  )
  expect(transition.changedPixels).toBe(true)
  expect(() => validateWarmInputLifecycle(result, ['ordinary/multiple'])).not.toThrow()
}, 30000)

async function readTransition(page) {
  await waitForConsumerSource(page)
  return page.evaluate(async () => {
    const readiness = await __stress.settleConsumers()
    const worker = globalThis.__inputWorkerProof.find(
      (worker) => worker.viewId === 'view-2' && !worker.terminated,
    )
    return {
      visible: document.getElementById('view-2').checkVisibility(),
      geometry: document.getElementById('view-2').getBoundingClientRect().toJSON(),
      publicationPoint: readiness.publicationPoint,
      receipt: readiness.minimaps.find((receipt) => receipt.viewId === 'view-2'),
      worker: {
        sourceUpdates: worker.sourceUpdates,
        latestRender: worker.latestRender,
        acceptedRender: worker.acceptedRender,
        pendingSourceRequests: worker.pendingSourceRequests,
        pendingRenderRequests: worker.pendingRenderRequests,
        failedResponses: worker.failedResponses,
        staleResponses: worker.staleResponses,
        sourceReceipt: worker.sourceReceipt,
        requestedRenderSource: worker.requestedRenderSource,
        acceptedRenderSource: worker.acceptedRenderSource,
        attestedRenderedSource: worker.attestedRenderedSource,
      },
      rpc: { tree: readiness.tree.pendingRequests, shiki: readiness.shiki.pendingRequests },
    }
  })
}

async function inputSession() {
  const context = await browser.newContext({ viewport: { width: 1000, height: 1000 } })
  await context.route('http://localhost:4173/**', async (route) => {
    const url = new URL(route.request().url())
    const fixture = /^\/frozen-fixtures\/([^/]+)\.txt$/.exec(url.pathname)?.[1]
    if (fixture) return route.fulfill({ body: fixtures[fixture], contentType: 'text/plain' })
    const path = resolve(directory, '.' + (url.pathname === '/' ? '/index.html' : url.pathname))
    const types = {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.html': 'text/html',
      '.wasm': 'application/wasm',
    }
    await route.fulfill({
      body: await readFile(path),
      contentType: types[extname(path)] ?? 'application/octet-stream',
    })
  })
  const page = await context.newPage()
  await page.addInitScript(installInputWorkerProof, null)
  await page.goto('http://localhost:4173/')
  await page.evaluate(() => document.fonts.ready)
  return { page, context, cdp: await context.newCDPSession(page) }
}
