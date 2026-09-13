import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import {
  meshOrigin,
  productionRoot,
  serverPort,
  serverUnit,
  tuiOrigin,
  unitTemplate,
} from './config'
import { log, run } from './run'
import { createScriptError } from '../structured-errors'

const unitDirectory = path.join(homedir(), '.config/systemd/user')
const installedUnit = path.join(unitDirectory, serverUnit)
const dropInDirectory = `${installedUnit}.d`

/** Installs the rendered unit when it differs; returns whether it changed. */
export async function installUnit(): Promise<boolean> {
  const rendered = renderUnit()
  const installed = existsSync(installedUnit) ? readFileSync(installedUnit, 'utf8') : null
  const dropIns = existsSync(dropInDirectory)
  if (installed === rendered && !dropIns) return false

  mkdirSync(unitDirectory, { recursive: true })
  writeFileSync(installedUnit, rendered)
  // Drop-ins predate the template; everything they set is rendered above.
  rmSync(dropInDirectory, { force: true, recursive: true })
  await systemctl('daemon-reload')
  await systemctl('enable', serverUnit)
  log('systemd', `installed ${installedUnit}`)
  return true
}

export async function restartServer() {
  log('systemd', `restarting ${serverUnit}`)
  await systemctl('restart', serverUnit)
}

export async function waitForServerRelease(expected: string, timeoutMs = 60_000) {
  const url = `http://127.0.0.1:${serverPort}/release`
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const release = await serverRelease(url)
    if (release === expected) return
    await Bun.sleep(500)
  }

  throw createScriptError(
    `${serverUnit} did not report release ${expected} within ${timeoutMs}ms. ` +
      `Check: journalctl --user -u ${serverUnit} -n 50`,
  )
}

async function serverRelease(url: string) {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const body = (await response.json()) as { server?: { release?: string | null } }
    return body.server?.release ?? null
  } catch {
    return null
  }
}

function renderUnit() {
  const values: Record<string, string> = {
    BUN: process.execPath,
    HOME: homedir(),
    MESH_ORIGIN: meshOrigin,
    PORT: String(serverPort),
    PRODUCTION_ROOT: productionRoot,
    TUI_ORIGIN: tuiOrigin,
  }
  return readFileSync(unitTemplate, 'utf8').replaceAll(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = values[key]
    if (value === undefined) throw createScriptError(`Unit template names unknown value ${key}.`)
    return value
  })
}

async function systemctl(...args: string[]) {
  const result = await run(['systemctl', '--user', ...args])
  if (result.code === 0) return

  throw createScriptError(`systemctl --user ${args.join(' ')} failed with exit ${result.code}.`)
}
