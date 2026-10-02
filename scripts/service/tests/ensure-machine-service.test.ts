import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureMachineService, removeMachineService } from '../ensure-machine-service'
import { registrationFiles, renderSystemdService, renderSystemdSocket } from '../units'
import { tryFileLock } from '../../../apps/server/src/system/file-lock'
import {
  cleanup,
  ENVIRONMENT_ID,
  fregatServer,
  freePort,
  MACHINE_ID,
  otherProgram,
  recordingHost,
  releaseRoot,
  scratch,
  silentListener,
} from './fixtures'

afterEach(cleanup)

async function setup(platform: NodeJS.Platform = 'linux') {
  const root = scratch()
  const stateHome = path.join(root, 'state')
  mkdirSync(stateHome)
  const port = await freePort()
  const address = `http://127.0.0.1:${port}`
  return { root, stateHome, port, address, productionRoot: releaseRoot(root), platform }
}

const intent = (address: string, stateHome: string) => ({
  stateHome,
  address,
  webBase: '/',
  expected: null,
})

describe('ensureMachineService', () => {
  it('registers the socket and service, then waits for the activated server to prove itself', async () => {
    const context = await setup()
    // Enabling the socket is when systemd would start answering at the address.
    const { host, commands } = recordingHost(context.root, 'linux', (argv) => {
      if (argv.includes('enable'))
        fregatServer({ port: context.port, stateHome: context.stateHome })
    })
    const result = await ensureMachineService(intent(context.address, context.stateHome), {
      productionRoot: context.productionRoot,
      host,
      readinessMs: 5000,
    })
    expect(result.disposition).toBe('registered')
    expect(result.identity).toMatchObject({
      stateHome: context.stateHome,
      address: context.address,
    })
    expect(commands).toEqual([
      ['systemctl', '--user', 'daemon-reload'],
      ['systemctl', '--user', 'enable', '--now', 'fregat-server.socket'],
    ])
    const values = {
      bun: '/opt/bun/bin/bun',
      releaseRoot: context.productionRoot,
      stateHome: context.stateHome,
      port: context.port,
    }
    const units = path.join(context.root, 'config', 'systemd', 'user')
    expect(readFileSync(path.join(units, 'fregat-server.socket'), 'utf8')).toBe(
      renderSystemdSocket(values),
    )
    expect(readFileSync(path.join(units, 'fregat-server.service'), 'utf8')).toBe(
      renderSystemdService(values),
    )
    expect(existsSync(path.join(context.productionRoot, 'bin', 'promote.ts'))).toBe(true)
  })

  it('reuses the server already serving this state home and registers nothing', async () => {
    const context = await setup()
    fregatServer({ port: context.port, stateHome: context.stateHome })
    const { host, commands } = recordingHost(context.root, 'linux')
    const result = await ensureMachineService(
      {
        ...intent(context.address, context.stateHome),
        expected: { machineId: MACHINE_ID as never, environmentId: ENVIRONMENT_ID as never },
      },
      { productionRoot: context.productionRoot, host, readinessMs: 5000 },
    )
    expect(result.disposition).toBe('reused')
    expect(commands).toEqual([])
    expect(existsSync(path.join(context.root, 'config'))).toBe(false)
  })

  it('compares the canonical state home when setup is given a link to it', async () => {
    const context = await setup()
    fregatServer({ port: context.port, stateHome: context.stateHome })
    const link = path.join(context.root, 'state-link')
    await Bun.$`ln -s ${context.stateHome} ${link}`
    const { host } = recordingHost(context.root, 'linux')
    const result = await ensureMachineService(intent(context.address, link), {
      productionRoot: context.productionRoot,
      host,
      readinessMs: 5000,
    })
    expect(result.disposition).toBe('reused')
  })

  it('names another Fregat state home as a conflict', async () => {
    const context = await setup()
    const other = path.join(context.root, 'other-state')
    mkdirSync(other)
    fregatServer({ port: context.port, stateHome: other })
    const { host } = recordingHost(context.root, 'linux')
    await expect(
      ensureMachineService(intent(context.address, context.stateHome), {
        productionRoot: context.productionRoot,
        host,
        readinessMs: 5000,
      }),
    ).rejects.toMatchObject({
      code: 'service.ADDRESS_HELD_BY_OTHER_FREGAT',
      internal: { mismatch: 'state-home' },
    })
  })

  it('names another environment in the same folder as a conflict', async () => {
    const context = await setup()
    fregatServer({ port: context.port, stateHome: context.stateHome })
    const { host } = recordingHost(context.root, 'linux')
    await expect(
      ensureMachineService(
        {
          ...intent(context.address, context.stateHome),
          expected: {
            machineId: MACHINE_ID as never,
            environmentId: '00000000-0000-4000-8000-000000000000' as never,
          },
        },
        { productionRoot: context.productionRoot, host, readinessMs: 5000 },
      ),
    ).rejects.toMatchObject({ internal: { mismatch: 'environment' } })
  })

  it('refuses a listener that claims this state home without its key', async () => {
    const context = await setup()
    const forger = path.join(context.root, 'forger')
    mkdirSync(forger)
    fregatServer({ port: context.port, stateHome: context.stateHome, keyHome: forger })
    // The real key exists; the forger signs with its own.
    const { ensureIdentityKey } = await import('../../../apps/server/src/system/identity-key')
    ensureIdentityKey(context.stateHome)
    const { host } = recordingHost(context.root, 'linux')
    await expect(
      ensureMachineService(intent(context.address, context.stateHome), {
        productionRoot: context.productionRoot,
        host,
        readinessMs: 5000,
      }),
    ).rejects.toMatchObject({ code: 'service.IDENTITY_UNVERIFIED', internal: { reason: 'proof' } })
  })

  it('waits out a listener that fails its first identity request', async () => {
    const context = await setup()
    fregatServer({ port: context.port, stateHome: context.stateHome })
    let calls = 0
    const flaky: typeof fetch = Object.assign(
      (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        calls++
        if (calls === 1) return Promise.reject(new TypeError('connection reset'))
        return fetch(input, init)
      },
      { preconnect: fetch.preconnect },
    )
    const { host, commands } = recordingHost(context.root, 'linux')
    const result = await ensureMachineService(intent(context.address, context.stateHome), {
      productionRoot: context.productionRoot,
      host,
      readinessMs: 5000,
      fetch: flaky,
    })
    expect(result.disposition).toBe('reused')
    expect(calls).toBeGreaterThan(1)
    expect(commands).toEqual([])
  })

  it('names the other program holding the address and leaves it running', async () => {
    const context = await setup()
    const program = otherProgram(context.port)
    const { host } = recordingHost(context.root, 'linux', (argv) =>
      argv[0] === 'ss'
        ? {
            code: 0,
            stdout: `LISTEN 0 512 127.0.0.1:${context.port} 0.0.0.0:* users:(("caddy",pid=4242,fd=7))\n`,
          }
        : undefined,
    )
    await expect(
      ensureMachineService(intent(context.address, context.stateHome), {
        productionRoot: context.productionRoot,
        host,
        readinessMs: 5000,
      }),
    ).rejects.toMatchObject({
      code: 'service.ADDRESS_HELD_BY_OTHER_PROGRAM',
      internal: { status: 404, holder: { name: 'caddy', pid: 4242 } },
    })
    expect((await fetch(program.url)).status).toBe(404)
  })

  it('gives up on a listener that never answers within the start time limit', async () => {
    const context = await setup()
    await silentListener(context.port)
    const { host } = recordingHost(context.root, 'linux')
    await expect(
      ensureMachineService(intent(context.address, context.stateHome), {
        productionRoot: context.productionRoot,
        host,
        readinessMs: 300,
      }),
    ).rejects.toMatchObject({
      code: 'service.IDENTITY_UNVERIFIED',
      internal: { reason: 'timeout' },
    })
  })

  it('leaves another installation’s unit file in place', async () => {
    const context = await setup()
    const socket = path.join(context.root, 'config', 'systemd', 'user', 'fregat-server.socket')
    mkdirSync(path.dirname(socket), { recursive: true })
    writeFileSync(socket, '[Socket]\nListenStream=127.0.0.1:9999\n')
    const { host, commands } = recordingHost(context.root, 'linux')
    await expect(
      ensureMachineService(intent(context.address, context.stateHome), {
        productionRoot: context.productionRoot,
        host,
        readinessMs: 2000,
      }),
    ).rejects.toMatchObject({ code: 'service.REGISTRATION_FAILED' })
    expect(readFileSync(socket, 'utf8')).toBe('[Socket]\nListenStream=127.0.0.1:9999\n')
    expect(commands).toEqual([])
  })

  it('refuses to register without a release to run', async () => {
    const context = await setup()
    const { host } = recordingHost(context.root, 'linux')
    await expect(
      ensureMachineService(intent(context.address, context.stateHome), {
        productionRoot: path.join(context.root, 'empty'),
        host,
        readinessMs: 2000,
      }),
    ).rejects.toMatchObject({ code: 'service.REGISTRATION_FAILED', internal: { stage: 'release' } })
  })

  it('converges two simultaneous setups on one registration', async () => {
    const context = await setup()
    let enables = 0
    const { host, commands } = recordingHost(context.root, 'linux', (argv) => {
      if (!argv.includes('enable')) return
      enables++
      fregatServer({ port: context.port, stateHome: context.stateHome })
    })
    const options = { productionRoot: context.productionRoot, host, readinessMs: 5000 }
    const results = await Promise.all([
      ensureMachineService(intent(context.address, context.stateHome), options),
      ensureMachineService(intent(context.address, context.stateHome), options),
    ])
    expect(results.map((result) => result.disposition).sort()).toEqual(['registered', 'reused'])
    expect(enables).toBe(1)
    expect(commands.filter((argv) => argv.includes('enable'))).toHaveLength(1)
  })

  it('bootstraps a LaunchAgent into the GUI domain on macOS', async () => {
    const context = await setup('darwin')
    const { host, commands } = recordingHost(context.root, 'darwin', (argv) => {
      if (argv[1] === 'print') return { code: 113 }
      if (argv[1] === 'bootstrap')
        fregatServer({ port: context.port, stateHome: context.stateHome })
    })
    const result = await ensureMachineService(intent(context.address, context.stateHome), {
      productionRoot: context.productionRoot,
      host,
      readinessMs: 5000,
    })
    const plist = path.join(
      context.root,
      'home',
      'Library',
      'LaunchAgents',
      'dev.fregat.server.plist',
    )
    expect(result.disposition).toBe('registered')
    expect(commands).toEqual([
      ['launchctl', 'print', 'gui/501/dev.fregat.server'],
      ['launchctl', 'bootstrap', 'gui/501', plist],
    ])
    expect(readFileSync(plist, 'utf8')).toContain(`<string>${context.port}</string>`)
  })

  it('refuses platforms without launchd or systemd', async () => {
    const context = await setup()
    const { host } = recordingHost(context.root, 'win32')
    await expect(
      ensureMachineService(intent(context.address, context.stateHome), {
        productionRoot: context.productionRoot,
        host,
      }),
    ).rejects.toMatchObject({ code: 'service.UNSUPPORTED_PLATFORM' })
  })
})

async function installed(platform: NodeJS.Platform = 'linux') {
  const context = await setup(platform)
  let server: ReturnType<typeof fregatServer> | undefined
  const recorded = recordingHost(context.root, platform, (argv) => {
    if (argv.includes('enable') || argv[1] === 'bootstrap')
      server = fregatServer({ port: context.port, stateHome: context.stateHome })
    if (argv[1] === 'print') return { code: 113 }
  })
  await ensureMachineService(intent(context.address, context.stateHome), {
    productionRoot: context.productionRoot,
    host: recorded.host,
    readinessMs: 5000,
  })
  recorded.commands.length = 0
  return { ...context, ...recorded, stopServer: () => server?.stop(true) }
}

describe('removeMachineService', () => {
  it('unregisters its own running socket and service and keeps the state', async () => {
    const context = await installed()
    expect(await removeMachineService({ host: context.host })).toEqual({ removed: true })
    expect(context.commands).toEqual([
      ['systemctl', '--user', 'disable', '--now', 'fregat-server.socket', 'fregat-server.service'],
      ['systemctl', '--user', 'daemon-reload'],
    ])
    const units = path.join(context.root, 'config', 'systemd', 'user')
    expect(existsSync(path.join(units, 'fregat-server.socket'))).toBe(false)
    expect(existsSync(context.stateHome)).toBe(true)
    expect(await removeMachineService({ host: context.host })).toEqual({ removed: false })
  })

  it('unregisters its own LaunchAgent', async () => {
    const context = await installed('darwin')
    expect(await removeMachineService({ host: context.host })).toEqual({ removed: true })
    expect(context.commands).toEqual([['launchctl', 'bootout', 'gui/501/dev.fregat.server']])
  })

  it.each(['linux', 'darwin'] as const)(
    'leaves a registration it did not write alone on %s',
    async (platform) => {
      const context = await setup(platform)
      const { host, commands } = recordingHost(context.root, platform)
      const file =
        platform === 'darwin'
          ? path.join(context.root, 'home', 'Library', 'LaunchAgents', 'dev.fregat.server.plist')
          : path.join(context.root, 'config', 'systemd', 'user', 'fregat-server.socket')
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, 'someone else’s registration\n')
      await expect(removeMachineService({ host })).rejects.toMatchObject({
        code: 'service.REGISTRATION_NOT_OURS',
        internal: { file: path.basename(file), reason: 'contents' },
      })
      expect(commands).toEqual([])
      expect(readFileSync(file, 'utf8')).toBe('someone else’s registration\n')
    },
  )

  it('leaves its registration alone while another program answers at its address', async () => {
    const context = await installed()
    // Same files, but the address now belongs to a stranger: the listener cannot prove itself.
    await context.stopServer()
    otherProgram(context.port)
    await expect(removeMachineService({ host: context.host })).rejects.toMatchObject({
      code: 'service.REGISTRATION_NOT_OURS',
      internal: { reason: 'listener' },
    })
    expect(context.commands).toEqual([])
  })

  it('keeps the files when the service manager refuses to stop the unit', async () => {
    const context = await installed()
    const refusing = recordingHost(context.root, 'linux', (argv) =>
      argv.includes('disable') ? { code: 1 } : undefined,
    )
    await expect(removeMachineService({ host: refusing.host })).rejects.toMatchObject({
      code: 'service.REGISTRATION_FAILED',
      internal: { stage: 'disable' },
    })
    const units = path.join(context.root, 'config', 'systemd', 'user')
    expect(existsSync(path.join(units, 'fregat-server.service'))).toBe(true)
  })

  // Two exact renders, each valid alone, for different installations.
  it('leaves a socket and service from different installations alone', async () => {
    const a = await setup()
    const bStateHome = path.join(a.root, 'state-b')
    mkdirSync(bStateHome)
    const bPort = await freePort()
    fregatServer({ port: bPort, stateHome: bStateHome })
    const { host, commands } = recordingHost(a.root, 'linux')
    const files = registrationFiles(host)
    if (files.kind !== 'systemd') throw new Error('expected systemd files')
    const values = { bun: host.bun, releaseRoot: a.productionRoot }
    mkdirSync(path.dirname(files.socket), { recursive: true })
    writeFileSync(
      files.socket,
      renderSystemdSocket({ ...values, stateHome: a.stateHome, port: a.port }),
    )
    const serviceB = renderSystemdService({ ...values, stateHome: bStateHome, port: bPort })
    writeFileSync(files.service, serviceB)
    await expect(removeMachineService({ host, readinessMs: 2000 })).rejects.toMatchObject({
      code: 'service.REGISTRATION_NOT_OURS',
      internal: { reason: 'mismatch' },
    })
    expect(commands).toEqual([])
    expect(readFileSync(files.service, 'utf8')).toBe(serviceB)
  })

  // The files change while uninstall waits for setup's lock; it must judge what is there then.
  it('judges the registration present once it holds the lock', async () => {
    const a = await installed()
    const files = registrationFiles(a.host)
    if (files.kind !== 'systemd') throw new Error('expected systemd files')
    await a.stopServer()
    const bStateHome = path.join(a.root, 'state-b')
    mkdirSync(bStateHome)
    const bPort = await freePort()
    otherProgram(bPort)
    const lock = tryFileLock(registrationFiles(a.host).lock)
    if (!lock) throw new Error('lock unavailable')
    const removal = removeMachineService({ host: a.host, readinessMs: 5000 })
    await Bun.sleep(200)
    const values = {
      bun: a.host.bun,
      releaseRoot: a.productionRoot,
      stateHome: bStateHome,
      port: bPort,
    }
    writeFileSync(files.socket, renderSystemdSocket(values))
    writeFileSync(files.service, renderSystemdService(values))
    lock.release()
    await expect(removal).rejects.toMatchObject({
      code: 'service.REGISTRATION_NOT_OURS',
      internal: { reason: 'listener' },
    })
    expect(a.commands).toEqual([])
    expect(readFileSync(files.service, 'utf8')).toBe(renderSystemdService(values))
  })

  // Only the socket was verified; a foreign service appearing during the probe must not be stopped.
  it('aborts when a registration file appears after the check', async () => {
    const context = await setup()
    const { host, commands } = recordingHost(context.root, 'linux')
    const files = registrationFiles(host)
    if (files.kind !== 'systemd') throw new Error('expected systemd files')
    const values = {
      bun: host.bun,
      releaseRoot: context.productionRoot,
      stateHome: context.stateHome,
      port: context.port,
    }
    mkdirSync(path.dirname(files.socket), { recursive: true })
    writeFileSync(files.socket, renderSystemdSocket(values))
    fregatServer({
      port: context.port,
      stateHome: context.stateHome,
      onRequest: () => writeFileSync(files.service, 'someone else’s service\n'),
    })
    await expect(removeMachineService({ host, readinessMs: 5000 })).rejects.toMatchObject({
      code: 'service.REGISTRATION_NOT_OURS',
      internal: { reason: 'changed' },
    })
    expect(commands).toEqual([])
    expect(readFileSync(files.service, 'utf8')).toBe('someone else’s service\n')
  })
})
