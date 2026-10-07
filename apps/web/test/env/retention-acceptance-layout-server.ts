import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TestProject } from 'vitest/node'
import { isolatedServerEnv } from '../../../../scripts/agent/isolated-server'
import { fixtureReadiness } from '../../../../scripts/agent/fixture-readiness'
import { isPortAvailable, selectAvailablePort } from '../../../../scripts/runtime-network'
import { createScriptError } from '../../../../scripts/structured-errors'
import { stopTerminalHost } from '../../../server/src/terminal-host/identity'
import { DEFAULT_PROVIDER_INSTANCES } from '../../../server/src/provider/drivers/built-in'

declare module 'vitest' {
  interface ProvidedContext {
    layoutPeerOrigin: string
  }
}

type LayoutServers = { peer: string; stop: () => Promise<void> }
const launches = new Map<string, { users: number; ready: Promise<LayoutServers> }>()

export async function selectLayoutPeerOrigin(preferred: URL, primary: URL, web: URL) {
  const port = await selectAvailablePort({
    preferredPort: Number(preferred.port),
    blockedPorts: [Number(primary.port), Number(web.port)],
    isAvailable: (candidate) => isPortAvailable('127.0.0.1', candidate),
  })
  return new URL(`http://127.0.0.1:${port}`)
}

export default async function setupLayoutServers(
  project: Pick<TestProject, 'getProvidedContext' | 'provide'>,
) {
  const peer = project.getProvidedContext().layoutPeerOrigin
  const primary = process.env.VITEST_BROWSER_FILE_SERVER_URL ?? 'http://127.0.0.1:33201'
  let shared = launches.get(primary)
  if (!shared) {
    shared = { users: 0, ready: startLayoutServers(peer, primary) }
    launches.set(primary, shared)
  }
  shared.users += 1
  const servers = await shared.ready
  project.provide('layoutPeerOrigin', servers.peer)
  return async () => {
    shared.users -= 1
    if (shared.users > 0) return
    launches.delete(primary)
    await servers.stop()
  }
}

export async function startLayoutServers(preferredPeer: string, primary: string) {
  const web = new URL(`http://127.0.0.1:${process.env.VITEST_BROWSER_PORT ?? '5179'}`)
  const stopPrimary = await startLayoutServer(new URL(primary), web, 'primary')
  try {
    const peer = await selectLayoutPeerOrigin(new URL(preferredPeer), new URL(primary), web)
    const stopPeer = await startLayoutServer(peer, web, 'peer')
    return {
      peer: peer.origin,
      stop: () => stopLayoutPair(stopPeer, stopPrimary),
    }
  } catch (error) {
    await stopPrimary()
    throw error
  }
}

async function stopLayoutPair(stopPeer: () => Promise<void>, stopPrimary: () => Promise<void>) {
  try {
    await stopPeer()
  } finally {
    await stopPrimary()
  }
}

async function startLayoutServer(origin: URL, web: URL, label: string) {
  await assertLayoutPortFree(origin)
  const directory = await mkdtemp(join(tmpdir(), `retention-layout-${label}-`))
  const home = join(directory, 'home')
  const root = join(directory, 'root')
  await mkdir(home)
  await mkdir(join(directory, 'served', 'web'), { recursive: true })
  await cp(fileURLToPath(new URL('../fixtures/workbench-file-server', import.meta.url)), root, {
    recursive: true,
  })
  await writeFile(
    join(root, 'repo/src/retention-layout.ts'),
    label === 'primary' ? fixtureSource : 'export const retainedEnvironmentValue = 37\n',
  )
  await writeFile(
    join(home, 'settings.json'),
    JSON.stringify({
      'providers.instances': DEFAULT_PROVIDER_INSTANCES.map((provider) => ({
        ...provider,
        enabled: false,
      })),
      'workbench.colorTheme': 'dark',
      'editor.codeTheme.dark': 'dark-plus',
      'workbench.wallpaper': { enabled: false, source: { kind: 'desktop' } },
    }),
  )
  const child = spawn('bun', ['src/index.ts'], {
    cwd: fileURLToPath(new URL('../../../server', import.meta.url)),
    env: {
      ...isolatedServerEnv({
        home,
        logs: join(directory, 'logs'),
        productionRoot: join(directory, 'production'),
        port: Number(origin.port),
        realProviders: false,
        scratchRoot: directory,
        webOrigin: web,
      }),
      FS_SYSTEM_ROOT: root,
      FS_WORKSPACE_ROOT: root,
      FS_WATCH: 'false',
      GIT_CEILING_DIRECTORIES: directory,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output: string[] = []
  child.stdout.on('data', (data: Buffer) => output.push(data.toString()))
  child.stderr.on('data', (data: Buffer) => output.push(data.toString()))
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      await exited
      clearTimeout(timer)
    }
    await stopTerminalHost(home)
    const evidence = await mkdtemp(join(tmpdir(), `retention-layout-${label}-server-evidence-`))
    await writeFile(join(evidence, 'server-output.txt'), output.join(''))
    await cp(join(directory, 'logs'), join(evidence, 'logs'), { recursive: true }).catch(
      () => undefined,
    )
    await rm(directory, { recursive: true, force: true })
  }
  try {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) break
      const ready = await fixtureReadiness(origin, web.origin, {
        signal: AbortSignal.timeout(1000),
      }).then(
        (response) => response.ok,
        () => false,
      )
      if (ready) return stop
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
    }
    throw createScriptError('Layout fixture server did not start', {
      internal: { label, output: output.join('') },
    })
  } catch (error) {
    await writeFile(
      join(tmpdir(), `retention-layout-${label}-failed-start.json`),
      JSON.stringify({
        label,
        exitCode: child.exitCode,
        signal: child.signalCode,
        output: output.join(''),
        failure: error instanceof Error ? error.message : String(error),
      }),
    )
    await stop()
    throw error
  }
}

export async function assertLayoutPortFree(origin: URL) {
  if (!(await isPortAvailable('127.0.0.1', Number(origin.port))))
    throw createScriptError('Layout fixture port is occupied', {
      internal: { port: Number(origin.port), hostname: '127.0.0.1', phase: 'before-spawn' },
    })
}

const fixtureSource =
  'export function layoutRegion() {\n' +
  Array.from({ length: 8 }, (_, i) => `  const layoutValue${i} = ${i}\n`).join('') +
  '  return layoutValue0 + layoutValue1 + layoutValue2 + layoutValue3 + layoutValue4 + layoutValue5 + layoutValue6 + layoutValue7\n}\n\nexport const wrappedLayout = "' +
  '0123456789abcdef'.repeat(14) +
  '"\n\nexport const finalLayoutValue = true\n'
