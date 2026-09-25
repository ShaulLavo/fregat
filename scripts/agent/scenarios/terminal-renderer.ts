import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { IsolatedServer } from '../isolated-server'
import { readLogs, type LogEvent } from '../logs'
import { runPaletteCommand, selectors, waitForApp } from '../selectors'
import { createScriptError } from '../../structured-errors'
import type { Scenario } from './index'

async function openRendererRow(page: Page) {
  await waitForApp(page)
  await runPaletteCommand(page, 'Show terminal')
  const surface = selectors.terminalSurface(page).first()
  await surface.waitFor()
  const row = selectors.terminalRendererRow(page)
  // The panel opens its menu only once the shell connects.
  for (let attempt = 0; attempt < 60; attempt++) {
    await surface.click({ button: 'right', position: { x: 100, y: 60 } })
    const shown = await row.waitFor({ timeout: 500 }).then(
      () => true,
      () => false,
    )
    if (shown) return row
    await page.keyboard.press('Escape')
  }
  throw createScriptError('The terminal menu never showed its renderer row')
}

/** Reloads so the scenario causes the mount it measures; returns the new page's client instance. */
async function reloadAsNewInstance(page: Page) {
  // After commit the old document is gone, so the next orchestration socket is the new page's.
  await page.reload({ waitUntil: 'commit' })
  const socket = await page.waitForEvent('websocket', {
    predicate: (candidate) => candidate.url().includes('/orchestration/rpc'),
    timeout: 30_000,
  })
  const instance = new URL(socket.url()).searchParams.get('instance')
  ok(instance, `The orchestration socket names no client instance: ${socket.url()}`)
  return instance
}

function clientInstance(event: LogEvent) {
  const client = event.client
  if (typeof client !== 'object' || client === null) return undefined
  return Reflect.get(client, 'instanceId')
}

/** Client and server logs each drain in 5 s batches, so this polls the server's file. */
async function mountLine(page: Page, server: IsolatedServer, instance: string, since: Date) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const events = await readLogs({
      action: 'terminal.mount',
      directory: server.logs,
      since,
      source: 'client',
    })
    const found = events.find((event) => clientInstance(event) === instance)
    if (found) return found
    await page.waitForTimeout(500)
  }
  throw createScriptError(
    `No terminal.mount line for client instance ${instance} in ${server.logs}`,
  )
}

const BACKEND_LABELS: Record<string, string> = {
  canvas2d: 'Renderer: Canvas',
  webgl2: 'Renderer: WebGL2',
  webgpu: 'Renderer: WebGPU',
}

async function readRendererRow(page: Page, server: IsolatedServer | undefined) {
  ok(server, 'The renderer scenarios read the throwaway API server log; drop --shared-dev')
  const since = new Date()
  const instance = await reloadAsNewInstance(page)
  const row = await openRendererRow(page)
  const label = (await row.textContent())?.trim() ?? ''
  const disabled = await row.getAttribute('aria-disabled')
  const font = await row.getByText(label).evaluate((node) => getComputedStyle(node).fontFamily)
  console.log(JSON.stringify({ disabled, font, instance, label }))
  strictEqual(disabled, 'true', 'The renderer row is informational')
  ok(label !== 'Renderer: starting', 'An open terminal has a renderer')
  const event = await mountLine(page, server, instance, since)
  console.log(JSON.stringify({ mountLine: event }))
  strictEqual(BACKEND_LABELS[String(event.rendererBackend)], label, 'The log names the same tier')
  return label
}

export const terminalRenderer: Scenario = {
  name: 'terminal-renderer',
  description: 'Reload, open the terminal menu and match its renderer row to the mount log line.',
  async run(page, { server, step }) {
    await readRendererRow(page, server)
    await step('terminal-menu-renderer')
  },
}

export const terminalRendererWebgl: Scenario = {
  name: 'terminal-renderer-webgl',
  description:
    'Remove navigator.gpu before the app loads, then check the terminal menu and log read WebGL2.',
  async run(page, { server, step }) {
    await page.addInitScript(() => {
      Reflect.deleteProperty(Navigator.prototype, 'gpu')
    })
    const label = await readRendererRow(page, server)
    await step('terminal-menu-renderer-webgl')
    strictEqual(label, 'Renderer: WebGL2')
  },
}
