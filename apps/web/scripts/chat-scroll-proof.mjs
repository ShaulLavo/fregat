import { mkdir, readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright'

const appUrl = process.env.CHAT_PROOF_URL ?? 'http://127.0.0.1:3300'
const artifactDirectory = process.env.CHAT_PROOF_ARTIFACTS ?? '/work/tmp/platform-chat-ux'
const phase = process.argv[2] ?? 'after'
const baselineSourceDirectory = process.env.CHAT_PROOF_BASELINE_SOURCE
const baselineModules = [
  'src/features/chat/components/messages-timeline.tsx',
  'src/features/chat/utils/timeline-scroll-anchoring.ts',
]
await mkdir(artifactDirectory, { recursive: true })
const browser = await chromium.launch({ channel: 'chromium', headless: true })
const context = await browser.newContext({
  colorScheme: 'dark',
  viewport: { width: 1100, height: 820 },
})
const page = await context.newPage()
page.setDefaultTimeout(10000)
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

try {
  const bundleDirectory = resolve(artifactDirectory, `${phase}-scroll-bundle`)
  await buildProof(bundleDirectory)
  await page.route(`${appUrl}/__chat-scroll-proof__/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname
    const filename = pathname.replace('/__chat-scroll-proof__/', '') || 'index.html'
    await route.fulfill({ path: resolve(bundleDirectory, filename) })
  })
  await page.goto(`${appUrl}/__chat-scroll-proof__/`)
  await page.getByRole('button', { name: 'Show full message' }).waitFor()
  await page.waitForTimeout(400)
  const before = await readPosition(page)
  await page.screenshot({ path: resolve(artifactDirectory, `${phase}-scroll-collapsed.png`) })
  await page.getByRole('button', { name: 'Show full message' }).focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const expanded = await readPosition(page)
  await page.screenshot({ path: resolve(artifactDirectory, `${phase}-scroll-expanded.png`) })
  await page.evaluate(() => window.chatScrollProof.append())
  await page.waitForTimeout(400)
  const appended = await readPosition(page)
  const resized = phase === 'after' ? await captureViewportResize(page) : null
  const keyboard = phase === 'after' ? await captureKeyboardNavigation(page) : null
  const work = phase === 'after' ? await captureWorkStates(page) : null
  const history = phase === 'after' ? await captureHistoryScrolling(page) : null
  if (phase === 'after') {
    assert.equal(
      before.jumpTabIndex,
      -1,
      'The hidden latest-message control must not receive focus.',
    )
    assert.equal(
      expanded.scrollTop,
      before.scrollTop,
      'Expanding content must preserve the reading position.',
    )
    assert.equal(
      appended.scrollTop,
      expanded.scrollTop,
      'New output must preserve an expanded reading position.',
    )
  }
  assert.deepEqual(errors, [], 'The proof must render without application errors.')
  const result = {
    phase,
    baselineScope: {
      modules: baselineModules,
      description:
        'Only these scroll modules are replaced for the baseline. All other UI components use current source.',
    },
    workComponents: ['MessagesTimeline', 'ComposerActivityStatus', 'ChatInput'],
    before,
    expanded,
    appended,
    resized,
    keyboard,
    work,
    history,
    errors,
  }
  await writeFile(
    resolve(artifactDirectory, `${phase}-scroll.json`),
    JSON.stringify(result, null, 2),
  )
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  await page.screenshot({ path: resolve(artifactDirectory, `${phase}-scroll-failed.png`) })
  console.error(JSON.stringify({ errors, content: await page.locator('body').innerText() }))
  throw error
} finally {
  await context.close()
  await browser.close()
}

function readPosition(page) {
  return page.evaluate(() => {
    const transcript = document.querySelector('[role="log"]')
    const body = document.querySelector('[data-user-message-collapsible="true"]')
    const jump = document.querySelector('[aria-label="Scroll to latest message"]')
    return {
      scrollTop: transcript.scrollTop,
      scrollHeight: transcript.scrollHeight,
      viewportHeight: transcript.clientHeight,
      messageTop: body?.getBoundingClientRect().top ?? null,
      jumpTabIndex: jump?.tabIndex ?? null,
      jumpVisible: jump ? getComputedStyle(jump).opacity !== '0' : false,
    }
  })
}

async function captureKeyboardNavigation(page) {
  await page.reload()
  await page.waitForTimeout(400)
  await page.mouse.click(350, 300)
  await page.keyboard.press('Control+Home')
  await page.waitForTimeout(300)
  const navigated = await readPosition(page)
  assert.equal(navigated.scrollTop, 0, 'Ctrl+Home must reach the oldest message.')
  assert.equal(navigated.jumpTabIndex, 0, 'Ctrl+Home must release transcript following.')
  await page.evaluate(() => window.chatScrollProof.append())
  await page.waitForTimeout(300)
  const appended = await readPosition(page)
  assert.equal(
    appended.scrollTop,
    navigated.scrollTop,
    'New output must preserve keyboard navigation.',
  )
  return { navigated, appended }
}

async function captureHistoryScrolling(page) {
  await page.setViewportSize({ width: 1100, height: 820 })
  await showLongWork(page, { outputLines: 2 })
  const live = page.locator('[data-live-activity]')
  await live.getByRole('button').first().click()
  const group = live.locator(':scope > [data-tool-group-scroll]')
  const textGrowth = await captureDisclosureAndTextGrowth(page, group)
  await showLongWork(page)
  await group.scrollIntoViewIfNeeded()
  await group.hover()
  await page.mouse.wheel(0, 100000)
  await page.waitForTimeout(300)
  await showLongWork(page, { count: 31 })
  const following = await readInnerScroll(group)
  assert.equal(following.top, following.maximum, 'A group at its end must follow appended actions.')
  await group.hover()
  await page.mouse.wheel(0, -40)
  await page.waitForTimeout(300)
  const reading = await readInnerScroll(group)
  await showLongWork(page, { count: 32 })
  assert.equal(
    (await readInnerScroll(group)).top,
    reading.top,
    'Appending must preserve a group reading position.',
  )

  await group.evaluate((element) => (element.scrollTop = 0))
  await group.getByRole('button').first().click()
  const output = group.locator('pre[aria-label="Output"]').first()
  await output.scrollIntoViewIfNeeded()
  await output.hover()
  await page.mouse.wheel(0, 100000)
  await page.waitForTimeout(300)
  await showLongWork(page, { count: 32, outputLines: 81 })
  const outputFollowing = await readInnerScroll(output)
  assert.equal(
    outputFollowing.top,
    outputFollowing.maximum,
    'Output at its end must follow appended text.',
  )
  await output.hover()
  await page.mouse.wheel(0, -72)
  await page.waitForTimeout(300)
  const outputReading = await readInnerScroll(output)
  await showLongWork(page, { count: 32, outputLines: 82 })
  assert.equal(
    (await readInnerScroll(output)).top,
    outputReading.top,
    'Output growth must preserve a reading position.',
  )

  await group.evaluate((element) => (element.scrollTop = 400))
  await page.waitForTimeout(200)
  const beforeUnmount = await readInnerScroll(group)
  await page.mouse.move(300, 100)
  await page.mouse.wheel(0, -100000)
  await page.waitForTimeout(400)
  assert.equal(await live.count(), 0, 'The restoration check must unmount the live row.')
  await page.getByRole('button', { name: 'Scroll to latest message' }).click()
  await page.waitForTimeout(300)
  const restored = await readInnerScroll(group)
  assert.equal(restored.top, beforeUnmount.top, 'Virtual unmounting must preserve group scroll.')
  assert.equal(
    (await readInnerScroll(output)).top,
    outputReading.top,
    'Virtual unmounting must preserve output scroll.',
  )

  await showLongWork(page, { count: 32, outputLines: 82, commentary: true })
  const historical = page
    .locator('[data-timeline-row-type="activity-group"] [data-tool-group-scroll]')
    .first()
  assert.equal(
    (await readInnerScroll(historical)).top,
    restored.top,
    'Moving live work into history must preserve its drawer.',
  )
  await showLongWork(page, { count: 32, outputLines: 82, commentary: true, newBlock: true })
  assert.equal(
    await live.getByRole('button').first().getAttribute('aria-expanded'),
    'false',
    'A new tool block must start collapsed.',
  )
  return { textGrowth, following, reading, outputFollowing, outputReading, beforeUnmount, restored }
}

async function captureDisclosureAndTextGrowth(page, group) {
  await group.getByRole('button').last().click()
  await page.waitForTimeout(300)
  const opened = await readInnerScroll(group)
  await showLongWork(page, { outputLines: 3 })
  assert.equal(
    (await readInnerScroll(group)).top,
    opened.top,
    'Text arriving after a disclosure must preserve the reader’s position.',
  )
  await group.evaluate((element) => (element.scrollTop = element.scrollHeight))
  await page.waitForTimeout(200)
  const before = await readInnerScroll(group)
  await showLongWork(page, { outputLines: 4 })
  const streamed = await readInnerScroll(group)
  assert.ok(streamed.maximum > before.maximum, 'The streamed text must grow its parent group.')
  assert.equal(
    streamed.top,
    streamed.maximum,
    'A group at its end must follow streamed child text.',
  )
  await showLongWork(page, { count: 31, outputLines: 4 })
  const appended = await readInnerScroll(group)
  assert.equal(
    appended.top,
    appended.maximum,
    'Streamed text must not disarm following later actions.',
  )
  await group.getByRole('button').nth(29).click()
  return { opened, before, streamed, appended }
}

async function showLongWork(page, options = {}) {
  await page.evaluate((value) => window.chatScrollProof.showLongWork(value), options)
  await page.waitForTimeout(300)
}

function readInnerScroll(locator) {
  return locator.evaluate((element) => ({
    top: element.scrollTop,
    maximum: element.scrollHeight - element.clientHeight,
  }))
}

async function captureViewportResize(page) {
  await page.getByRole('button', { name: 'Scroll to latest message' }).click()
  await page.setViewportSize({ width: 1100, height: 720 })
  await page.waitForTimeout(300)
  const position = await readPosition(page)
  assert.equal(
    position.scrollHeight - position.viewportHeight - position.scrollTop,
    0,
    'Following must keep the latest output visible when the viewport shrinks.',
  )
  await page.setViewportSize({ width: 1100, height: 820 })
  return position
}

async function captureWorkStates(page) {
  const captures = []
  for (const kind of ['running', 'next-tool', 'stopped', 'completed']) {
    await page.evaluate((state) => window.chatScrollProof.showWork(state), kind)
    await page.waitForTimeout(400)
    await assertWorkState(page, kind)
    await page.screenshot({ path: resolve(artifactDirectory, `after-work-${kind}.png`) })
    captures.push({ kind, text: await page.locator('main').innerText() })
  }
  captures.push(await assertCompletedFold(page))
  await page.evaluate(() => window.chatScrollProof.showWork('next-tool'))
  await page.waitForTimeout(250)
  const live = page.locator('[data-live-activity]')
  await live.getByRole('button').first().click()
  await openSearchOutput(live)
  await page.screenshot({ path: resolve(artifactDirectory, 'after-work-expanded.png') })
  await page.setViewportSize({ width: 320, height: 740 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: resolve(artifactDirectory, 'after-work-narrow.png') })
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'The narrow chat must not scroll horizontally.',
  )
  captures.push({ kind: 'narrow', ...(await assertNarrowOutputReachable(page, live)) })
  return captures
}

async function assertWorkState(page, kind) {
  const transcript = page.getByRole('log', { name: 'Messages' })
  const live = transcript.locator('[data-live-activity]')
  const active = kind === 'running' || kind === 'next-tool'
  assert.equal(await live.count(), active ? 1 : 0, `${kind} must have the correct live row count.`)
  assert.equal(
    await transcript.locator('[data-slot="spinner"]').count(),
    active ? 1 : 0,
    `${kind} must have the correct live spinner count.`,
  )
  if (active) {
    const expected = kind === 'running' ? 'Running rg' : 'Running bun'
    assert.equal(await live.getByRole('status').innerText(), expected)
    return
  }
  if (kind === 'stopped') {
    assert.equal(await transcript.getByText('You stopped after 12s', { exact: true }).count(), 1)
    return
  }
  assert.equal(
    await transcript.getByRole('button', { name: 'Worked for 12s · 4 steps', exact: true }).count(),
    1,
  )
  assert.equal(
    await transcript
      .getByText('Verified the gutter in dark and light mode.', { exact: true })
      .count(),
    1,
  )
}

async function assertCompletedFold(page) {
  const fold = page.locator('[data-timeline-row-type="turn-fold"]')
  const toggle = fold.locator('button[data-scroll-anchor-ignore]').first()
  assert.equal(await toggle.innerText(), 'Worked for 12s · 4 steps')
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
  await toggle.click()
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
  assert.equal(await toggle.innerText(), 'Worked for 12s · Hide steps')
  await openSearchOutput(fold)
  await page.screenshot({ path: resolve(artifactDirectory, 'after-work-completed-expanded.png') })
  return {
    kind: 'completed-fold',
    expanded: true,
    command: await fold.locator('pre[aria-label="Command"]').innerText(),
    outputLines: (await fold.locator('pre[aria-label="Output"]').innerText()).split('\n').length,
  }
}

async function openSearchOutput(container) {
  const commandToggle = container.locator('button:has(> span[title="Ran rg"])')
  assert.equal(await commandToggle.locator('[title="Ran rg"]').innerText(), 'Ran rg')
  if ((await commandToggle.getAttribute('aria-expanded')) !== 'true') await commandToggle.click()
  const command = container.locator('pre[aria-label="Command"]')
  const output = container.locator('pre[aria-label="Output"]')
  assert.equal(
    await command.innerText(),
    '/usr/bin/bash -lc "rg -n gutter-background packages/ui/src/styles/globals.css"',
  )
  const text = await output.innerText()
  assert.equal(text.split('\n').length, 35, 'Expanded history must expose every output line.')
  assert.equal(
    text.endsWith(
      'packages/ui/src/styles/globals.css:929: --editor-gutter-background: var(--background-solid);',
    ),
    true,
  )
}

async function assertNarrowOutputReachable(page, live) {
  const output = live.locator('pre[aria-label="Output"]')
  await output.scrollIntoViewIfNeeded()
  await output.hover()
  const outerBefore = await page.getByRole('log').evaluate((element) => element.scrollTop)
  await page.mouse.wheel(0, 100000)
  await page.waitForTimeout(300)
  const geometry = await output.evaluate((element) => {
    const group = element.parentElement.closest('[data-tool-group-scroll]')
    const transcript = element.closest('[role="log"]')
    const composer = document.querySelector('[data-proof-composer]')
    const text = element.lastChild
    const lastLine = document.createRange()
    lastLine.setStart(text, Math.max(0, text.textContent.length - 10))
    lastLine.setEnd(text, text.textContent.length)
    const line = lastLine.getBoundingClientRect()
    const outputBox = element.getBoundingClientRect()
    const groupBox = group.getBoundingClientRect()
    const transcriptBox = transcript.getBoundingClientRect()
    const composerBox = composer.getBoundingClientRect()
    return {
      innerScrollTop: element.scrollTop,
      innerScrollMaximum: element.scrollHeight - element.clientHeight,
      outerScrollTop: transcript.scrollTop,
      lastLineTop: line.top,
      lastLineBottom: line.bottom,
      visibleTop: Math.max(outputBox.top, groupBox.top, transcriptBox.top),
      visibleBottom: Math.min(
        outputBox.bottom,
        groupBox.bottom,
        transcriptBox.bottom,
        composerBox.top,
      ),
      transcriptBottom: transcriptBox.bottom,
      composerTop: composerBox.top,
    }
  })
  assert.ok(geometry.innerScrollMaximum > 0, 'This check must exercise overflowing tool output.')
  assert.ok(
    Math.abs(geometry.innerScrollTop - geometry.innerScrollMaximum) <= 1,
    'A real wheel must reach the final output line.',
  )
  assert.equal(
    geometry.outerScrollTop,
    outerBefore,
    'Scrolling nested output must preserve the transcript position.',
  )
  assert.ok(
    geometry.lastLineTop >= geometry.visibleTop &&
      geometry.lastLineBottom <= geometry.visibleBottom,
    'The last output line must be visible through every parent clip and above the composer.',
  )
  assert.ok(
    geometry.transcriptBottom <= geometry.composerTop,
    'The composer must not cover transcript content.',
  )
  await page.screenshot({ path: resolve(artifactDirectory, 'after-work-narrow-output-end.png') })
  return geometry
}

async function buildProof(outDir) {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const entryId = resolve(appRoot, 'scripts/chat-scroll-proof-entry.mjs')
  await build({
    configFile: false,
    root: appRoot,
    base: '/__chat-scroll-proof__/',
    logLevel: 'warn',
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'chat-scroll-proof',
        async load(id) {
          if (!baselineSourceDirectory) return
          if (id.endsWith('/src/features/chat/components/messages-timeline.tsx')) {
            return readFile(resolve(baselineSourceDirectory, 'messages-timeline.tsx'), 'utf8')
          }
          if (id.endsWith('/src/features/chat/utils/timeline-scroll-anchoring.ts')) {
            return readFile(
              resolve(baselineSourceDirectory, 'timeline-scroll-anchoring.ts'),
              'utf8',
            )
          }
        },
      },
    ],
    resolve: { alias: { '@': resolve(appRoot, 'src') }, dedupe: ['react', 'react-dom'] },
    define: { 'import.meta.env.VITE_SERVER_URL': JSON.stringify('http://127.0.0.1:3301') },
    worker: { format: 'es' },
    build: {
      outDir,
      emptyOutDir: true,
      cssCodeSplit: false,
      sourcemap: false,
      minify: false,
      rollupOptions: { input: entryId, output: { entryFileNames: 'proof.js' } },
    },
  })
  const assets = await import('node:fs/promises').then(({ readdir }) =>
    readdir(resolve(outDir, 'assets')),
  )
  const stylesheet = assets.find((name) => name.endsWith('.css'))
  await writeFile(
    resolve(outDir, 'index.html'),
    `<html><head><link rel="stylesheet" href="./assets/${stylesheet}"></head><body><div id="proof-root"></div><script type="module" src="./proof.js"></script></body></html>`,
  )
}
