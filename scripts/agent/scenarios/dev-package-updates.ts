import { ok, strictEqual } from 'node:assert/strict'
import { utimes } from 'node:fs/promises'
import path from 'node:path'
import { checkoutRoot } from '../paths'
import { openFileByName, selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

const inspection = new WeakMap<object, unknown>()

export const devPackageUpdates: Scenario = {
  name: 'dev-package-updates',
  requiresIsolatedServer: true,
  description:
    'Invalidate loaded package source and verify native Vite reloads restore the editor and terminal.',
  inspect: async (page) => inspection.get(page) ?? null,
  async run(page, { file, step }) {
    const events: { file: string; before: number; after: number }[] = []
    const hmr: unknown[] = []
    inspection.set(page, { events, hmr })
    const waitForModules = trackModules(page)
    const connections: { ready: boolean; output: string }[] = []
    page.on('websocket', (socket) => {
      if (!new URL(socket.url()).pathname.endsWith('/terminal')) {
        if (new URL(socket.url()).host !== new URL(page.url()).host) return
        socket.on('framereceived', ({ payload }) => {
          if (typeof payload === 'string') hmr.push(JSON.parse(payload))
        })
        return
      }
      const connection = { ready: false, output: '' }
      connections.push(connection)
      socket.on('framereceived', ({ payload }) => {
        if (typeof payload !== 'string') {
          connection.output += payload.toString('utf8')
          return
        }
        if (JSON.parse(payload).type === 'ready') connection.ready = true
      })
    })
    await page.reload()
    await waitForApp(page)
    await selectors.windowToolbar(page).click({ position: { x: 300, y: 10 } })
    await openFileByName(page, file)
    await selectors.terminalSurface(page).first().waitFor()
    await waitForTerminal(page, () => connections.at(-1)?.ready === true)
    await selectors
      .terminalSurface(page)
      .first()
      .click({ position: { x: 100, y: 60 } })
    await page.keyboard.type("printf '\\nDEV_PACKAGE_REPLAY\\n'")
    await page.keyboard.press('Enter')
    await waitForTerminal(
      page,
      () => connections.at(-1)?.output.includes('DEV_PACKAGE_REPLAY') === true,
    )
    await waitForModules()
    const startupReloads = hmr.filter(
      (event) =>
        typeof event === 'object' && event !== null && Reflect.get(event, 'type') === 'full-reload',
    ).length
    strictEqual(startupReloads, 0, 'Cold dependency loading must avoid optimizer page reloads')
    await step('mounted-editor-and-terminal')
    for (const relative of [
      'editor/packages/react/src/index.tsx',
      'editor/packages/editor/src/editor.ts',
      'ghostty-webgpu/src/core/runtime.ts',
      'ghostty-webgpu/src/dom/terminal.ts',
    ]) {
      const before = await page.evaluate(() => performance.timeOrigin)
      const oldSurface = await (
        relative.startsWith('ghostty-webgpu/')
          ? selectors.terminalSurface(page).first().locator('canvas').first()
          : selectors.editorSurface(page).first()
      ).elementHandle()
      const source = path.join(checkoutRoot, relative)
      ok(oldSurface, 'The surface is mounted before its implementation changes')
      const changedAt = new Date()
      await utimes(source, changedAt, changedAt)
      await waitForReplacement(page, oldSurface, before)
      await selectors.editorInput(page).first().waitFor({ timeout: 30_000 })
      await selectors.terminalSurface(page).first().locator('canvas').first().waitFor()
      await waitForTerminal(
        page,
        () =>
          connections.at(-1)?.ready === true &&
          connections.at(-1)?.output.includes('DEV_PACKAGE_REPLAY') === true,
      )
      await waitForModules()
      const after = await page.evaluate(() => performance.timeOrigin)
      events.push({ file: relative, before, after })
      await step(`updated-${events.length}`)
    }
    const before = await page.evaluate(() => performance.timeOrigin)
    const now = new Date()
    await utimes(path.join(checkoutRoot, 'editor/packages/react/dist/index.js'), now, now)
    await page.waitForTimeout(1500)
    strictEqual(
      await page.evaluate(() => performance.timeOrigin),
      before,
      'Generated output must leave the page running',
    )
    inspection.set(page, {
      events,
      hmr,
      startupReloads,
      connections: connections.length,
      generatedReload: false,
    })
    await step('generated-output-ignored')
  },
}

async function waitForTerminal(page: Parameters<Scenario['run']>[0], condition: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return
    await page.waitForTimeout(100)
  }
  ok(condition(), 'The terminal must connect and replay its output')
}

async function waitForReplacement(
  page: Parameters<Scenario['run']>[0],
  element: import('playwright').ElementHandle,
  origin: number,
) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if ((await page.evaluate(() => performance.timeOrigin)) !== origin) return
    if (!(await element.evaluate((node) => node.isConnected).catch(() => false))) return
    await page.waitForTimeout(100)
  }
  ok(false, 'Vite must replace the mounted implementation or reload the page')
}

function trackModules(page: Parameters<Scenario['run']>[0]) {
  const pending = new Set<import('playwright').Request>()
  let lastActivity = Date.now()
  page.on('request', (request) => {
    if (new URL(request.url()).host !== new URL(page.url()).host) return
    pending.add(request)
    lastActivity = Date.now()
  })
  const settled = (request: import('playwright').Request) => {
    if (!pending.delete(request)) return
    lastActivity = Date.now()
  }
  page.on('requestfinished', settled)
  page.on('requestfailed', settled)
  return async () => {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (pending.size === 0 && Date.now() - lastActivity >= 1000) return
      await page.waitForTimeout(100)
    }
    ok(
      pending.size === 0 && Date.now() - lastActivity >= 1000,
      'Source module requests must settle before the next update',
    )
  }
}
