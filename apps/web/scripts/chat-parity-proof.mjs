import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright'

const app = resolve(import.meta.dirname, '..')
const origin = process.env.CHAT_PROOF_URL ?? 'http://127.0.0.1:3300'
const artifacts = process.env.CHAT_PROOF_ARTIFACTS ?? '/work/tmp/platform-chat-parity/browser'
const bundle = resolve(artifacts, 'bundle')
const entry = resolve(app, 'scripts/chat-scroll-proof-entry.mjs')
await mkdir(artifacts, { recursive: true })
await build({
  configFile: false,
  root: app,
  base: '/__chat-parity-proof__/',
  logLevel: 'error',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'chat-parity-proof',
      async load(id) {
        if (id !== entry) return
        return (
          (await readFile(entry, 'utf8')) +
          `
import { agentConversation } from '../test/factories/chat-agents';
import { chatTimelineItems } from '@/features/chat/utils/timeline-items';
window.chatParityProof = {
  agents(running) {
    const next = agentConversation(running);
    window.chatScrollProof.render(next.messages, next);
    return chatTimelineItems({ ...next, optimisticMessages: [] });
  },
  replay(snapshot) { window.chatScrollProof.render(snapshot.messages, factories.session(snapshot)); }
};`
        )
      },
    },
  ],
  resolve: { alias: { '@': resolve(app, 'src') }, dedupe: ['react', 'react-dom'] },
  define: { 'import.meta.env.VITE_SERVER_URL': JSON.stringify('http://127.0.0.1:3301') },
  worker: { format: 'es' },
  build: {
    outDir: bundle,
    emptyOutDir: true,
    cssCodeSplit: false,
    minify: false,
    rollupOptions: { input: entry, output: { entryFileNames: 'proof.js' } },
  },
})
const css = (await readdir(resolve(bundle, 'assets'))).find((name) => name.endsWith('.css'))
await writeFile(
  resolve(bundle, 'index.html'),
  `<html class="dark"><head><link rel="stylesheet" href="./assets/${css}"></head><body><div id="proof-root"></div><script type="module" src="./proof.js"></script></body></html>`,
)
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1100, height: 920 }, colorScheme: 'dark' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.route(`${origin}/__chat-parity-proof__/**`, (route) => {
    const filename =
      new URL(route.request().url()).pathname.replace('/__chat-parity-proof__/', '') || 'index.html'
    return route.fulfill({ path: resolve(bundle, filename) })
  })
  await page.goto(`${origin}/__chat-parity-proof__/`)
  await page.waitForFunction(() => window.chatParityProof)
  const running = await page.evaluate(() => window.chatParityProof.agents(true))
  assert.equal(running.filter((item) => item.type === 'agent-group').length, 1)
  assert.equal(
    running.filter((item) => item.type === 'activity-group').length,
    0,
    'Child commands must stay out of the parent work log.',
  )
  await page.getByRole('button', { name: '1 agent working' }).click()
  const dialog = page.getByRole('dialog', { name: 'Agents' })
  await dialog.getByRole('button', { name: /Locke/ }).click()
  await dialog
    .getByText("rg -n 'sessionDiff' apps/server/src/missing", { exact: true })
    .first()
    .waitFor()
  await dialog.getByRole('button', { name: /tool call failed/ }).click()
  await dialog.getByText(/Exit code 2/).waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ path: resolve(artifacts, 'agents-running.png') })
  await page.evaluate(() => window.chatParityProof.agents(false))
  await dialog.getByText('Idle · resumable', { exact: true }).waitFor()
  assert.equal(
    await dialog.getByRole('button', { name: /Locke/ }).getAttribute('aria-expanded'),
    'true',
    'Completion must preserve the open agent details.',
  )
  await page.screenshot({ path: resolve(artifacts, 'agents-completed.png') })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: '1 agent finished' }).click()
  await dialog.getByText('Idle · resumable', { exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(300)
  const panel = await dialog.boundingBox()
  assert.ok(
    panel && panel.x >= 0 && panel.x + panel.width <= 391,
    'Agent details must fit a narrow window.',
  )
  assert.ok(
    panel.y >= 0 && panel.y + panel.height <= 845,
    'Agent details must fit the window height.',
  )
  await page.screenshot({ path: resolve(artifacts, 'agents-narrow.png') })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  let replay = null
  if (process.env.CHAT_PROOF_SNAPSHOT) {
    await page.setViewportSize({ width: 1100, height: 920 })
    const snapshot = JSON.parse(await readFile(process.env.CHAT_PROOF_SNAPSHOT, 'utf8'))
    await page.evaluate((snapshot) => window.chatParityProof.replay(snapshot), snapshot)
    await page.locator('[role=log]').evaluate((element) => {
      element.scrollTop = 0
    })
    await page.waitForTimeout(300)
    replay = await page.locator('[data-timeline-row-type]').evaluateAll((elements) =>
      elements.map((element) => ({
        type: element.dataset.timelineRowType,
        top: element.getBoundingClientRect().top,
        height: element.getBoundingClientRect().height,
        text: element.textContent.slice(0, 180),
      })),
    )
    await page.screenshot({ path: resolve(artifacts, 'last-chat-replay.png') })
  }
  assert.deepEqual(errors, [])
  const result = { runningTypes: running.map((item) => item.type), panel, replay, errors }
  await writeFile(resolve(artifacts, 'proof.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  await page.screenshot({ path: resolve(artifacts, 'failed.png') })
  console.error(JSON.stringify({ errors, content: await page.locator('body').innerText() }))
  throw error
} finally {
  await browser.close()
}
