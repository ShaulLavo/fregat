import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { readFsLogs, tailFsLogs } from 'evlog/fs'
import { readLogs } from '../../../../../scripts/agent/logs'
import { createLogRetention } from '../../../../../packages/observability/src/retention'
import path from 'node:path'
import { expect, vi } from 'vitest'
import * as v from 'valibot'
import { serverIdentitySchema } from '@workspace/contracts'
import {
  flushDesktopObservability,
  initializeDesktopObservability,
  recordDesktopInfo,
} from '../observability'
import { ensureInstalledService, installationIntent } from '../installation-client'
import { test, readLogEvents } from './fixtures/observability'

test('production service launch persists desktop events beside server logs without OBSERVABILITY_DIR', async ({
  logging,
}) => {
  expect(Bun.env.OBSERVABILITY_DIR).toBeUndefined()
  const runtime = initializeDesktopObservability(logging)
  const intent = installationIntent(logging.stateHome)
  const service = await ensureInstalledService({
    intent,
    productionRoot: logging.releaseRoot,
    signal: new AbortController().signal,
    ensure: async () => ({
      disposition: 'reused',
      identity: v.parse(serverIdentitySchema, {
        product: 'fregat',
        protocolVersion: 1,
        machineId: 'a'.repeat(32),
        environmentId: '11111111-1111-4111-8111-111111111111',
        stateHome: intent.stateHome,
        address: intent.address,
        webBase: intent.webBase,
        service: { kind: 'systemd-socket', registrationId: 'fixture.service' },
      }),
    }),
  })
  recordDesktopInfo('desktop.service.ready', { disposition: service.disposition })
  recordDesktopInfo('desktop.browser.detect', { candidates: [{ kind: 'webview' }] })
  recordDesktopInfo('desktop.window.open', { engine: 'fixture' })
  await flushDesktopObservability()
  expect(runtime.config.environment).toBe('production')
  const events = await readLogEvents(path.join(logging.releaseRoot, 'logs'))
  expect(events.map((event) => event.action)).toEqual([
    'desktop.service.ready',
    'desktop.browser.detect',
    'desktop.window.open',
  ])
  for (const event of events) {
    expect(event).toMatchObject({ source: 'desktop', area: 'desktop', level: 'info' })
    expect(event.timestamp).toEqual(expect.any(String))
  }
  expect(Bun.env.OBSERVABILITY_DIR).toBeUndefined()
})

test('dev logging keeps environment configuration', async ({ logging }) => {
  const logDir = path.join(logging.root, 'dev-logs')
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('OBSERVABILITY_DIR', logDir)
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  const runtime = initializeDesktopObservability()
  recordDesktopInfo('desktop.shared_dev.wait')
  await flushDesktopObservability()
  expect(runtime.config.environment).toBe('development')
  expect(runtime.config.logDir).toBe(logDir)
  expect(await readLogEvents(logDir)).toContainEqual(
    expect.objectContaining({ action: 'desktop.shared_dev.wait', source: 'desktop' }),
  )
})

test('flushed bootstrap events stay in state-home logs when the release root becomes known', async ({
  logging,
}) => {
  initializeDesktopObservability({ stateHome: logging.stateHome })
  recordDesktopInfo('desktop.bootstrap.fixture')
  await flushDesktopObservability()
  initializeDesktopObservability(logging)
  recordDesktopInfo('desktop.service.ready')
  await flushDesktopObservability()
  expect(await readLogEvents(path.join(logging.stateHome, 'logs'))).toContainEqual(
    expect.objectContaining({ action: 'desktop.bootstrap.fixture', source: 'desktop' }),
  )
  expect(await readLogEvents(path.join(logging.releaseRoot, 'logs'))).toContainEqual(
    expect.objectContaining({ action: 'desktop.service.ready', source: 'desktop' }),
  )
})

test('two process writers rotate and prune their own series without losing the other writer events', async ({
  logging,
}) => {
  const directory = path.join(logging.releaseRoot, 'logs')
  const writer = path.join(import.meta.dirname, 'fixtures/log-writer.ts')
  const desktop = Bun.spawn([process.execPath, writer, directory, 'desktop'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const desktopErrors = new Response(desktop.stderr).text()
  try {
    const ready = await desktop.stdout.getReader().read()
    expect(new TextDecoder().decode(ready.value)).toContain('ready')
    const server = Bun.spawn([process.execPath, writer, directory, 'be'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [serverCode, serverErrors] = await Promise.all([
      server.exited,
      new Response(server.stderr).text(),
    ])
    expect(serverCode, serverErrors).toBe(0)
    expect(await readLogEvents(directory)).toContainEqual(
      expect.objectContaining({ action: 'desktop.before_server_rotation' }),
    )
    desktop.stdin.end()
    expect(await desktop.exited, await desktopErrors).toBe(0)
    const expected = [
      'desktop.before_server_rotation',
      'server.rotation.2',
      'desktop.after_server_rotation',
    ]
    const events = await readLogEvents(directory)
    expect(events.map((event) => event.action).sort()).toEqual(expected.toSorted())
    const files = (await readdir(directory)).filter((name) => name.endsWith('.jsonl'))
    expect(files.filter((name) => name.startsWith('desktop-'))).toHaveLength(2)
    expect(files.filter((name) => !name.startsWith('desktop-'))).toHaveLength(1)
    const since = new Date(Date.now() - 60_000)
    const history = []
    for await (const event of readFsLogs({ dir: directory, since })) history.push(event.action)
    expect(history.sort()).toEqual(expected.toSorted())
    const tailed = []
    for await (const event of tailFsLogs({ dir: directory, since })) {
      tailed.push(event.action)
      if (tailed.length === expected.length) break
    }
    expect(tailed.sort()).toEqual(expected.toSorted())
    const cliEvents = await readLogs({ directory, since })
    expect(cliEvents.map((event) => event.action)).toEqual(expected)
    expect(await readLogs({ directory, since, source: 'desktop' })).toHaveLength(2)
  } finally {
    desktop.stdin.end()
    desktop.kill()
    await desktop.exited
  }
})

test('age retention removes only its own file series', async ({ logging }) => {
  const directory = path.join(logging.releaseRoot, 'logs')
  await mkdir(directory, { recursive: true })
  const names = [
    '2020-01-01.jsonl',
    '2020-01-01.1.jsonl',
    'desktop-2020-01-01.jsonl',
    'desktop-2020-01-01.1.jsonl',
    'notes.jsonl',
  ]
  await Promise.all(names.map((name) => writeFile(path.join(directory, name), '{}\n')))
  const serverRetention = createLogRetention(
    directory,
    () => 1,
    () => {},
  )
  expect(await serverRetention()).toBe(2)
  expect((await readdir(directory)).sort()).toEqual(names.slice(2).sort())
  const desktopRetention = createLogRetention(
    directory,
    () => 1,
    () => {},
    'desktop-',
  )
  expect(await desktopRetention()).toBe(2)
  expect(await readdir(directory)).toEqual(['notes.jsonl'])
})

for (const stage of ['release', 'early'] as const) {
  test(`real production launcher records ${stage} startup failure in its active logs without starting a service`, async ({
    logging,
  }) => {
    if (stage === 'release') {
      await writeFile(
        path.join(logging.stateHome, 'settings.json'),
        JSON.stringify({ 'server.releaseRoot': logging.releaseRoot }),
      )
      await writeFile(path.join(logging.stateHome, 'desktop/installation.json'), '{}')
    } else {
      await mkdir(path.join(logging.stateHome, 'settings.json'))
    }
    const build = await Bun.build({
      entrypoints: [path.join(import.meta.dirname, '../index.ts')],
      target: 'bun',
    })
    expect(build.success).toBe(true)
    await Bun.write(logging.launcher, build.outputs[0]!)
    const env: Record<string, string | undefined> = {
      ...process.env,
      PLATFORM_HOME: logging.stateHome,
    }
    delete env.OBSERVABILITY_DIR
    delete env.OBSERVABILITY_ENABLED
    const child = Bun.spawn([process.execPath, logging.launcher], {
      cwd: logging.root,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect(code, stderr).toBe(1)
    const directory = path.join(
      stage === 'release' ? logging.releaseRoot : logging.stateHome,
      'logs',
    )
    const events = await readLogEvents(directory)
    expect(events).toContainEqual(
      expect.objectContaining({
        action: 'desktop.start_failed',
        source: 'desktop',
        area: 'desktop',
        level: 'error',
      }),
    )
  })
}
