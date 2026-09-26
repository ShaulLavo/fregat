import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'

import {
  notifyServer,
  renderUnit,
  restartInto,
  type ReleaseBody,
  type ServerControl,
} from './systemd'
import type { SignalOutcome } from './systemd/promote'

const values = {
  BUN: '/opt/bun',
  HOME: '/home/owner',
  MESH_ORIGIN: 'https://mesh.example',
  PORT: '3301',
  PRODUCTION_ROOT: '/srv/platform',
  TUI_ORIGIN: 'platform-tui://local',
}

test('the unit checks for approved promotion before startup and treats Restart as success', () => {
  const unit = renderUnit(values)

  expect(unit).not.toContain('{{')
  const lines = unit.split('\n')
  const pre = lines.indexOf('ExecStartPre=-/opt/bun /srv/platform/bin/promote.ts /srv/platform')
  expect(pre).toBeGreaterThan(-1)
  expect(lines.indexOf('ExecStart=/opt/bun /srv/platform/current/server/index.js')).toBe(pre + 1)
  expect(lines).toContain('SuccessExitStatus=143 75')
  expect(lines).toContain('RestartForceExitStatus=75')
  expect(lines).toContain('Environment=PLATFORM_PRODUCTION_ROOT=/srv/platform')
})

type Scripted = {
  state?: string
  signal?: SignalOutcome
  /** The body GET /release answers with, given the calls so far. */
  body: (calls: readonly string[]) => ReleaseBody | null
}

function scripted({ state = 'active', signal = 'signalled', body }: Scripted) {
  const calls: string[] = []
  let time = 0
  const control: ServerControl = {
    activeState: async () => state,
    systemctl: async (...args) => {
      calls.push(args.join(' '))
    },
    releaseBody: async () => body(calls),
    signal: async () => {
      calls.push('SIGUSR2')
      return signal
    },
    launch: (argv) => {
      calls.push(`launch ${argv.find((arg) => arg.startsWith('--unit=')) ?? ''}`)
      return true
    },
    approve: (name) => {
      calls.push(`approve ${name}`)
    },
    now: () => time,
    sleep: async (ms) => {
      time += ms
    },
  }
  return { calls, control, elapsed: () => time }
}

const unit = 'platform-prod.service'
const running = (release: string, rest: Omit<ReleaseBody, 'server'> = { pending: null }) => ({
  server: { release },
  ...rest,
})

test('a server without the pending key restarts once into the new release', async () => {
  const server = scripted({
    body: (calls) =>
      calls.includes(`restart ${unit}`) ? running('B') : { server: { release: 'A' } },
  })

  await expect(notifyServer('B', server.control)).resolves.toBe('restarted')
  expect(server.calls).toEqual(['approve B', `restart ${unit}`])
})

test('a server reporting pending: null is signalled and never restarted', async () => {
  const server = scripted({
    body: (calls) =>
      calls.includes('SIGUSR2') ? running('A', { pending: { release: 'B' } }) : running('A'),
  })

  await expect(notifyServer('B', server.control)).resolves.toBe('staged')
  expect(server.calls).toEqual(['SIGUSR2'])
})

test('a server already reporting the release counts as promoted', async () => {
  const server = scripted({ body: () => running('B') })

  await expect(notifyServer('B', server.control)).resolves.toBe('promoted')
  expect(server.calls).toEqual([])
})

test('a stopped server is started so its promotion step takes the release', async () => {
  const server = scripted({
    state: 'inactive',
    body: (calls) => (calls.includes(`start ${unit}`) ? running('B') : null),
  })

  await expect(notifyServer('B', server.control)).resolves.toBe('started')
  expect(server.calls).toEqual(['approve B', `start ${unit}`])
})

test('a failed server is reset before it is started', async () => {
  const server = scripted({
    state: 'failed',
    body: (calls) => (calls.includes(`start ${unit}`) ? running('B') : null),
  })

  await expect(notifyServer('B', server.control)).resolves.toBe('started')
  expect(server.calls).toEqual(['approve B', `reset-failed ${unit}`, `start ${unit}`])
})

test('a signal the server never acknowledges fails after 15s without a restart', async () => {
  const server = scripted({ body: () => running('A') })

  await expect(notifyServer('B', server.control)).rejects.toThrow(/B is staged/)
  expect(server.calls).toEqual(['SIGUSR2'])
  expect(server.elapsed()).toBeGreaterThanOrEqual(15_000)
})

test('a server that cannot take the signal fails without a restart', async () => {
  const server = scripted({ signal: 'incapable', body: () => running('A') })

  await expect(notifyServer('B', server.control)).rejects.toThrow(/gave incapable/)
  expect(server.calls).toEqual(['SIGUSR2'])
})

test('a rollback restart launches its check first and waits for the target name', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'deploy-restart-'))
  const target = { name: 'A', directory, previous: null, source: '/work/checkout' }
  const server = scripted({
    body: (calls) => (calls.includes(`restart ${unit}`) ? running('A') : running('B')),
  })

  try {
    await expect(restartInto(target, true, server.control)).resolves.toBe('platform-live-check-A')
    expect(server.calls).toEqual(['launch --unit=platform-live-check-A', `restart ${unit}`])
    await expect(restartInto(target, false, server.control)).resolves.toBeNull()
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('a restart that never reports the target name fails', async () => {
  const target = { name: 'A', directory: '/nonexistent', previous: null, source: '/x' }
  const server = scripted({ body: () => running('B') })

  await expect(restartInto(target, false, server.control)).rejects.toThrow(
    /did not report release A/,
  )
})
