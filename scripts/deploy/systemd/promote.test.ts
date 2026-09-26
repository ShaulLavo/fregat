import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'

import { approveRestart } from '../../../apps/server/src/update/staged-release'

import { liveCheckCommand, promote, releaseProblem, signalServer } from './promote'

let root = ''
let launched: string[][] = []

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'deploy-promote-'))
  launched = []
})

afterEach(() => {
  rmSync(root, { force: true, recursive: true })
})

function launch(argv: readonly string[]) {
  launched.push([...argv])
  return true
}

function release(name: string, config: Record<string, unknown> = {}) {
  const directory = path.join(root, 'releases', name)
  const modules = path.join(root, 'modules')
  mkdirSync(path.join(directory, 'server'), { recursive: true })
  mkdirSync(path.join(directory, 'web'), { recursive: true })
  mkdirSync(modules, { recursive: true })
  writeFileSync(path.join(directory, 'server/index.js'), '')
  writeFileSync(path.join(directory, 'web/index.html'), '')
  writeFileSync(
    path.join(directory, 'build-config.json'),
    JSON.stringify({ source: '/work/checkout', ...config }),
  )
  symlinkSync(modules, path.join(directory, 'server/node_modules'))
  symlinkSync(modules, path.join(directory, 'node_modules'))
  return directory
}

function link(name: 'current' | 'pending', target: string) {
  symlinkSync(target, path.join(root, name))
}

function approve() {
  const pending = path.join(root, 'pending')
  approveRestart(root, {
    release: path.basename(readlinkSync(pending)),
    stagedAt: lstatSync(pending).mtime.toISOString(),
  })
}

function current() {
  return readlinkSync(path.join(root, 'current'))
}

function hasPending() {
  try {
    return lstatSync(path.join(root, 'pending')).isSymbolicLink()
  } catch {
    return false
  }
}

test('nothing staged leaves current alone', () => {
  const live = release('A')
  link('current', live)

  expect(promote(root, launch)).toBe('none')
  expect(current()).toBe(live)
  expect(launched).toEqual([])
})

test('ordinary service starts preserve a staged release until Restart approves it', () => {
  const live = release('A')
  link('current', live)
  link('pending', release('B'))
  expect(promote(root, launch)).toBe('none')
  expect(promote(root, launch)).toBe('none')
  expect(current()).toBe(live)
  expect(hasPending()).toBe(true)
  expect(launched).toEqual([])
})

test('a dangling pending link is removed and never promoted', () => {
  const live = release('A')
  link('current', live)
  link('pending', path.join(root, 'releases', 'gone'))

  approve()
  expect(promote(root, launch)).toBe('rejected')
  expect(hasPending()).toBe(false)
  expect(current()).toBe(live)
})

test('a release whose node_modules link dangles is rejected', () => {
  const live = release('A')
  const broken = release('B')
  rmSync(path.join(broken, 'server/node_modules'))
  symlinkSync(path.join(root, 'nowhere'), path.join(broken, 'server/node_modules'))
  link('current', live)
  link('pending', broken)

  expect(releaseProblem(broken)).toBe(`${broken} is missing server/node_modules`)
  approve()
  expect(promote(root, launch)).toBe('rejected')
  expect(hasPending()).toBe(false)
  expect(current()).toBe(live)
  expect(launched).toEqual([])
})

test('a staged release that is already current is dropped', () => {
  const live = release('A')
  link('current', live)
  link('pending', live)

  approve()
  expect(promote(root, launch)).toBe('already-current')
  expect(hasPending()).toBe(false)
  expect(launched).toEqual([])
})

test('a valid release is promoted and its live check starts outside the service', () => {
  const live = release('A')
  const next = release('B')
  writeFileSync(path.join(next, 'live-check.json'), '{"status":"failed"}')
  link('current', live)
  link('pending', next)

  approve()
  expect(promote(root, launch)).toBe('promoted')
  expect(current()).toBe(next)
  expect(hasPending()).toBe(false)
  expect(existsSync(path.join(next, 'live-check.json'))).toBe(false)
  expect(launched).toHaveLength(1)
  const argv = launched[0] ?? []
  expect(argv.slice(0, 7)).toEqual([
    'systemd-run',
    '--user',
    '--no-block',
    '--collect',
    '--quiet',
    '--expand-environment=no',
    '--unit=platform-live-check-B',
  ])
  expect(argv).toContain('--working-directory=/work/checkout')
  expect(argv).toContain(
    `--property=ExecStopPost=-${process.execPath} ${path.join(root, 'bin/promote.ts')} notify`,
  )
  const script = argv.indexOf('/work/checkout/scripts/deploy/live-check.mjs')
  expect(argv[script - 1]).toMatch(/node$/)
  expect(argv.slice(script + 1)).toEqual([
    '--release=B',
    `--out=${next}`,
    `--baseline=${path.join(live, 'live-check.json')}`,
    `--logs=${path.join(root, 'logs')}`,
    '--wait-for-server=120000',
  ])
})

test('a release deployed with --skip-live-check is promoted without a check', () => {
  const live = release('A')
  const next = release('B', { liveCheck: false })
  link('current', live)
  link('pending', next)

  approve()
  expect(promote(root, launch)).toBe('promoted')
  expect(current()).toBe(next)
  expect(launched).toEqual([])
})

test('the inline check runs in the checkout without waiting for a restart', () => {
  const target = { name: 'B', directory: '/r/B', previous: null, source: '/work/checkout' }
  const command = liveCheckCommand(target, '/srv/platform', 0)

  expect(command.cwd).toBe('/work/checkout')
  expect(command.env.PATH).toBe(process.env.PATH)
  expect(command.argv.slice(1)).toEqual([
    '/work/checkout/scripts/deploy/live-check.mjs',
    '--release=B',
    '--out=/r/B',
    '--baseline=',
    '--logs=/srv/platform/logs',
  ])
})

test('the signal goes only to a server that answers with a pending key', async () => {
  const kills: string[][] = []
  const kill = (argv: readonly string[]) => kills.push([...argv]) > 0
  let body: Record<string, unknown> = { release: 'A', server: { release: 'A' } }
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => Response.json(body) })
  try {
    expect(await signalServer(server.port, kill)).toBe('incapable')
    expect(kills).toEqual([])

    body = { ...body, pending: null }
    expect(await signalServer(server.port, kill)).toBe('signalled')
    expect(kills).toEqual([
      [
        'systemctl',
        '--user',
        'kill',
        '--kill-whom=main',
        '--signal=SIGUSR2',
        'platform-prod.service',
      ],
    ])
  } finally {
    await server.stop(true)
  }
  expect(await signalServer(server.port, kill)).toBe('unreachable')
})

test('an approval cannot promote a replacement stage or authorize a later start', () => {
  const live = release('A')
  link('current', live)
  link('pending', release('B'))
  approve()
  rmSync(path.join(root, 'pending'))
  const next = release('C')
  link('pending', next)
  expect(promote(root, launch)).toBe('none')
  expect(current()).toBe(live)
  expect(hasPending()).toBe(true)
  expect(existsSync(path.join(root, 'restart-approved.json'))).toBe(false)
  approve()
  expect(promote(root, launch)).toBe('promoted')
  link('pending', release('D'))
  expect(promote(root, launch)).toBe('none')
  expect(current()).toBe(next)
})

test('a promotion leaves no claim behind on any outcome', () => {
  link('current', release('A'))
  link('pending', release('B'))
  approve()
  rmSync(path.join(root, 'pending'))
  link('pending', release('C'))
  expect(promote(root, launch)).toBe('none')
  approve()
  expect(promote(root, launch)).toBe('promoted')
  expect(readdirSync(root).filter((name) => name.startsWith('pending.claim-'))).toEqual([])
})
