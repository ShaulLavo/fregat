import { expect, test } from 'vitest'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { acquireProfileLock } from '../profile-lock'

// Chromium's POSIX singleton and flock require Linux or macOS.
const posixTest = test.skipIf(process.platform !== 'linux' && process.platform !== 'darwin')

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'fregat-lock-'))
  const profile = path.join(root, 'chromium')
  await mkdir(profile)
  return { root, profile }
}
function options(profile: string, milliseconds = 1000, signal?: AbortSignal) {
  const until = performance.now() + milliseconds
  return { profile, remainingMs: () => until - performance.now(), pollMs: 5, signal }
}

posixTest(
  'a second launcher waits for the same profile lock and releases its descriptor after the startup cap',
  async () => {
    const box = await fixture()
    const release = await acquireProfileLock(options(box.profile))
    try {
      await expect(acquireProfileLock(options(box.profile, 50))).rejects.toMatchObject({
        code: 'desktop.launcher.PROFILE_BUSY',
        internal: { reason: 'launcher-lock-limit' },
      })
    } finally {
      release()
    }
    try {
      ;(await acquireProfileLock(options(box.profile)))()
    } finally {
      await rm(box.root, { recursive: true, force: true })
    }
  },
)

posixTest(
  'cancellation while waiting on the profile lock releases the waiting descriptor',
  async () => {
    const box = await fixture()
    const release = await acquireProfileLock(options(box.profile))
    const controller = new AbortController()
    try {
      const waiting = acquireProfileLock(options(box.profile, 1000, controller.signal))
      controller.abort()
      await expect(waiting).rejects.toThrow()
    } finally {
      release()
      await rm(box.root, { recursive: true, force: true })
    }
  },
)

posixTest(
  'kernel lock ownership ends when a launcher dies, leaving a reusable lock inode',
  async () => {
    const box = await fixture()
    const ready = path.join(box.root, 'ready')
    const entry = path.resolve(import.meta.dirname, '../profile-lock.ts')
    const child = Bun.spawn(
      [
        process.execPath,
        '-e',
        `
    const { acquireProfileLock } = await import(${JSON.stringify(entry)});
    await acquireProfileLock({ profile: ${JSON.stringify(box.profile)}, remainingMs: () => 1000, pollMs: 5 });
    await Bun.write(${JSON.stringify(ready)}, ${JSON.stringify(hostname())});
    setInterval(() => {}, 1000);
  `,
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    )
    try {
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !(await Bun.file(ready).exists())) await Bun.sleep(5)
      expect(await readFile(ready, 'utf8')).toBe(hostname())
      child.kill('SIGKILL')
      await child.exited
      const release = await acquireProfileLock(options(box.profile))
      release()
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
      await child.exited
      await rm(box.root, { recursive: true, force: true })
    }
  },
)
