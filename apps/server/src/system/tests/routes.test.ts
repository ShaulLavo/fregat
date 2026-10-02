import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  nativePickerResultSchema,
  serverCapabilitiesSchema,
  serverIdentitySchema,
  type MachineId,
} from '@workspace/contracts'
import * as v from 'valibot'
import { afterEach, describe, expect, it } from 'vitest'
import { closeTestApps, createTestApp } from '../../../test/server'
import { testSettingsOptions } from '../../settings/testing'
import { ensureIdentityKey, IDENTITY_PROOF_HEADER, identityProof } from '../identity-key'
import { systemErrors } from '../structured-errors'
import { probeAddress } from '../../../../../scripts/service/probe'

const MACHINE_ID = '0123456789abcdef0123456789abcdef'
const roots: string[] = []
const servers: Array<{ stop: (force?: boolean) => unknown }> = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true)
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function scratch() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-system-'))
  roots.push(root)
  return root
}

async function freePort() {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
  const port = server.port
  await server.stop(true)
  if (!port) throw new Error('no free port')
  return port
}

async function helperScript(body: string) {
  const root = await scratch()
  const file = path.join(root, 'helper')
  await writeFile(file, `#!/bin/sh\nROOT=${JSON.stringify(root)}\n${body}\n`)
  await chmod(file, 0o700)
  return { file, root }
}

async function listening(
  options: { helper?: string | null; desktop?: boolean; machineId?: () => MachineId } = {},
) {
  const root = await scratch()
  const stateHome = path.join(root, 'state')
  await mkdir(stateHome, { mode: 0o700 })
  // Setup compares canonical paths, so the server resolves the link it was given.
  const linked = path.join(root, 'linked-state')
  await symlink(stateHome, linked)
  // The address is the listener's own origin, as Host and Origin name it.
  const port = await freePort()
  const address = `http://127.0.0.1:${port}`
  const app = createTestApp({
    auth: { allowedOrigins: [address, 'http://localhost:5173'] },
    settings: testSettingsOptions(root),
    system: {
      address,
      webBase: '/',
      service: { kind: 'systemd-socket', registrationId: 'fregat-server.socket' },
      stateHome: linked,
      machineId:
        options.machineId ?? (() => v.parse(serverIdentitySchema.entries.machineId, MACHINE_ID)),
      nativePickerHelper: options.helper ?? null,
      desktop: () => options.desktop ?? true,
    },
  })
  app.listen({ hostname: '127.0.0.1', port })
  const server = app.server
  if (!server?.port) throw new Error('test server did not listen')
  // The Bun listener only: closeTestApps runs the app's cleanup once, after this stops.
  servers.push(server)
  return { base: `http://127.0.0.1:${port}`, stateHome: linked, canonical: stateHome }
}

function get(base: string, route: string, headers: Record<string, string> = { origin: base }) {
  return fetch(`${base}${route}`, { headers })
}

function pick(
  base: string,
  body: unknown,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
) {
  return fetch(`${base}/fs/native-picker`, {
    method: 'POST',
    headers: { origin: base, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  })
}

async function code(response: Response) {
  return ((await response.json()) as { error?: { code?: string } }).error?.code
}

describe('system identity', () => {
  it('answers this machine with the canonical state home and a proof of its key', async () => {
    const { base, stateHome, canonical } = await listening()
    const key = ensureIdentityKey(stateHome)
    const response = await get(base, '/system/identity?challenge=abcdefghijklmnop0123')
    expect(response.status).toBe(200)
    const identity = v.parse(serverIdentitySchema, await response.json())
    expect(identity).toMatchObject({
      product: 'fregat',
      machineId: MACHINE_ID,
      address: base,
      webBase: '/',
      stateHome: await realpath(canonical),
      service: { kind: 'systemd-socket', registrationId: 'fregat-server.socket' },
    })
    const health = (await (await get(base, '/health')).json()) as { environmentId: string }
    expect(identity.environmentId).toBe(health.environmentId)
    expect(response.headers.get(IDENTITY_PROOF_HEADER)).toBe(
      identityProof(key, 'abcdefghijklmnop0123'),
    )
  })

  it('preserves the identity proof on a machine-id failure and the probe recognizes its server', async () => {
    const { base, stateHome } = await listening({
      machineId: () => {
        throw systemErrors.MACHINE_ID_UNAVAILABLE({ internal: { platform: 'darwin', exitCode: 1 } })
      },
    })
    const key = ensureIdentityKey(stateHome)
    const challenge = 'abcdefghijklmnop0123'
    const response = await get(base, `/system/identity?challenge=${challenge}`)
    expect(response.status).toBe(500)
    expect(await code(response)).toBe('system.MACHINE_ID_UNAVAILABLE')
    expect(response.headers.get(IDENTITY_PROOF_HEADER)).toBe(identityProof(key, challenge))
    expect(await probeAddress({ address: base, stateHome, timeoutMs: 5000 })).toEqual({
      kind: 'fregat-error',
      status: 500,
      serverCode: 'system.MACHINE_ID_UNAVAILABLE',
    })
  })

  it.each([
    ['mesh forwarding of this machine’s own browser', { 'x-forwarded-for': '127.0.0.1' }],
    ['a proxy hop', { via: '1.1 fregat' }],
    ['another allowed origin', { origin: 'http://localhost:5173' }],
  ])('refuses %s', async (_, extra: Record<string, string>) => {
    const { base } = await listening()
    const response = await get(base, '/system/identity', { origin: base, ...extra })
    expect(response.status).toBe(403)
    expect(await code(response)).toBe('system.NOT_LOCAL')
  })
})

describe('system capabilities', () => {
  it('offers the native chooser only to a local request on a machine with a helper', async () => {
    const { file } = await helperScript(`echo '{"event":"picked","paths":[]}'`)
    const { base } = await listening({ helper: file })
    const local = v.parse(
      serverCapabilitiesSchema,
      await (await get(base, '/system/capabilities')).json(),
    )
    expect(local).toMatchObject({ machineId: MACHINE_ID, nativePicker: true })
    const forwarded = await get(base, '/system/capabilities', {
      origin: base,
      'x-forwarded-for': '127.0.0.1',
    })
    expect(v.parse(serverCapabilitiesSchema, await forwarded.json()).nativePicker).toBe(false)
  })

  // What Chromium sends for the installed page's same-origin fetch: no Origin on a GET.
  it('offers the chooser to a same-origin browser read without Origin', async () => {
    const { file } = await helperScript(`echo '{"event":"picked","paths":[]}'`)
    const { base } = await listening({ helper: file })
    const browser = { 'sec-fetch-site': 'same-origin', referer: `${base}/` }
    const local = await get(base, '/system/capabilities', browser)
    expect(v.parse(serverCapabilitiesSchema, await local.json()).nativePicker).toBe(true)
    const crossSite = await get(base, '/system/capabilities', {
      'sec-fetch-site': 'cross-site',
      referer: 'https://evil.example/',
    })
    expect(crossSite.status).not.toBe(200)
  })

  it('reports no chooser without a desktop session', async () => {
    const { file } = await helperScript(`echo '{"event":"picked","paths":[]}'`)
    const { base } = await listening({ helper: file, desktop: false })
    const body = v.parse(
      serverCapabilitiesSchema,
      await (await get(base, '/system/capabilities')).json(),
    )
    expect(body.nativePicker).toBe(false)
  })
})

describe('native picker endpoint', () => {
  it('returns the paths a local request selected', async () => {
    const { file } = await helperScript(`echo '{"event":"picked","paths":["/srv/project"]}'`)
    const { base } = await listening({ helper: file })
    const response = await pick(base, { mode: 'folder' })
    expect(response.status).toBe(200)
    expect(v.parse(nativePickerResultSchema, await response.json())).toEqual({
      outcome: 'selected',
      paths: ['/srv/project'],
    })
  })

  it('refuses a forwarded request without starting the helper', async () => {
    const { file, root } = await helperScript(
      `touch "$ROOT/started"\necho '{"event":"picked","paths":[]}'`,
    )
    const { base } = await listening({ helper: file })
    const response = await pick(base, { mode: 'folder' }, { 'x-forwarded-for': '127.0.0.1' })
    expect(response.status).toBe(403)
    expect(await code(response)).toBe('system.NATIVE_PICKER_NOT_LOCAL')
    await expect(stat(path.join(root, 'started'))).rejects.toThrow()
  })

  it('refuses a foreign origin before anything else', async () => {
    const { file } = await helperScript(`echo '{"event":"picked","paths":[]}'`)
    const { base } = await listening({ helper: file })
    const response = await pick(base, { mode: 'folder' }, { origin: 'https://evil.example' })
    expect(response.status).toBe(403)
    expect(await code(response)).toBe('FORBIDDEN_ORIGIN')
  })

  it('refuses invalid options with the picker code', async () => {
    const { file } = await helperScript(`echo '{"event":"picked","paths":[]}'`)
    const { base } = await listening({ helper: file })
    const response = await pick(base, { mode: 'save' })
    expect(response.status).toBe(400)
    expect(await code(response)).toBe('system.NATIVE_PICKER_INVALID_OPTIONS')
  })

  it('stops the helper when the requester disconnects', async () => {
    const { file, root } = await helperScript(`echo $$ > "$ROOT/pid"\nexec sleep 30`)
    const { base } = await listening({ helper: file })
    const controller = new AbortController()
    const pending = pick(base, { mode: 'folder' }, {}, controller.signal).catch(() => null)
    const pid = await waitForPid(root)
    controller.abort()
    await pending
    await expect.poll(() => alive(pid), { timeout: 5000 }).toBe(false)
  })
})

async function waitForPid(root: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const text = await readFile(path.join(root, 'pid'), 'utf8').catch(() => '')
    if (text.trim()) return Number(text)
    await Bun.sleep(20)
  }
  throw new Error('helper never started')
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
