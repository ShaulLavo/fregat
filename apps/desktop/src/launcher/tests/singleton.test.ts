import { expect, test } from 'vitest'
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { createServer } from 'node:net'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { singletonState } from '../singleton'

// Chromium's POSIX singleton and flock require Linux or macOS.
const posixTest = test.skipIf(process.platform !== 'linux' && process.platform !== 'darwin')

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'fregat-singleton-'))
  const profile = path.join(root, 'profile')
  await mkdir(profile)
  return { root, profile }
}

posixTest.each(['missing', 'live', 'dead', 'foreign', 'malformed'])(
  'profile singleton %s has a bounded read-only state',
  async (kind) => {
    const box = await fixture()
    const child = Bun.spawn([process.execPath, '-e', 'process.exit(0)'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    await child.exited
    const targets: Record<string, string> = {
      live: `${hostname()}-${process.pid}`,
      dead: `${hostname()}-${child.pid}`,
      foreign: 'foreign-host-1',
      malformed: `${hostname()}-not-pid`,
    }
    try {
      if (kind !== 'missing') await symlink(targets[kind]!, path.join(box.profile, 'SingletonLock'))
      const expected: Record<string, string> = {
        missing: 'idle',
        live: 'live',
        dead: 'idle',
        foreign: 'unverified',
        malformed: 'unverified',
      }
      expect(await singletonState(box.profile, 1000)).toBe(expected[kind])
    } finally {
      await rm(box.root, { recursive: true, force: true })
    }
  },
)

posixTest.each(['matching', 'mismatched', 'missing', 'direct'])(
  'socket cookie %s follows Chromium singleton rules and transmits no launch data',
  async (kind) => {
    const box = await fixture()
    const file =
      kind === 'direct' ? path.join(box.profile, 'SingletonSocket') : path.join(box.root, 'socket')
    const received: Array<Buffer | string> = []
    const server = createServer((socket) => {
      socket.on('data', (value) => received.push(value))
      socket.on('end', () => socket.end())
    })
    await new Promise<void>((resolve) => server.listen(file, resolve))
    try {
      await symlink('foreign-host-1', path.join(box.profile, 'SingletonLock'))
      if (kind !== 'direct') await symlink(file, path.join(box.profile, 'SingletonSocket'))
      if (kind !== 'missing') await symlink('cookie', path.join(box.profile, 'SingletonCookie'))
      await symlink(
        kind === 'mismatched' ? 'other' : 'cookie',
        path.join(box.root, 'SingletonCookie'),
      )
      expect(await singletonState(box.profile, 1000)).toBe(
        kind === 'matching' || kind === 'direct' ? 'live' : 'unverified',
      )
      expect(received).toEqual([])
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(box.root, { recursive: true, force: true })
    }
  },
)
