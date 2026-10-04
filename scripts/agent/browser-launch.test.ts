import { existsSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import path from 'node:path'
import { expect, test } from 'vitest'
import { browserTempRoot, launchBrowser, prepareBrowserTemp } from './browser-launch'
import { chromium } from 'playwright'

const browserUnavailable = process.platform !== 'linux' || !existsSync(chromium.executablePath())
if (browserUnavailable) console.info('Browser storage checks require Linux and installed Chromium.')

async function parentPid(pid: string) {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '')
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]
}

async function descendants(root: string) {
  const pids = (await readdir('/proc')).filter((name) => /^\d+$/.test(name))
  const parents = new Map(
    await Promise.all(pids.map(async (pid) => [pid, await parentPid(pid)] as const)),
  )
  const found = new Set([root])
  for (let grew = true; grew;) {
    grew = false
    for (const [pid, parent] of parents) {
      if (found.has(pid) || !parent || !found.has(parent)) continue
      found.add(pid)
      grew = true
    }
  }
  found.delete(root)
  return [...found]
}

/** Every Chromium shared-memory file the browsers this process started hold open. */
async function chromiumSharedMemory() {
  const targets = new Set<string>()
  for (const pid of await descendants(String(process.pid))) {
    const fds = await readdir(`/proc/${pid}/fd`).catch(() => [])
    for (const fd of fds) {
      const target = await readlink(`/proc/${pid}/fd/${fd}`).catch(() => '')
      if (target.includes('.org.chromium.')) targets.add(target.replace(/ \(deleted\)$/, ''))
    }
  }
  return [...targets]
}

// Playwright's --disable-dev-shm-usage puts these files in TMPDIR, fully allocated; on a tmpfs
// they count against the job's memory cap, so they must live in the run's disk-backed directory.
test.skipIf(browserUnavailable)(
  'Chromium keeps its shared memory in a run directory it removes on close',
  async () => {
    const browser = await launchBrowser('chromium', false)
    let targets: string[] = []
    try {
      const page = await browser.newPage()
      await page.setContent('<p>shared memory</p>')
      targets = await chromiumSharedMemory()
    } finally {
      await browser.close()
    }
    expect(targets.length).toBeGreaterThan(0)
    const directories = new Set(targets.map((target) => path.dirname(target)))
    expect([...directories]).toHaveLength(1)
    const [directory] = directories
    expect(path.dirname(directory!)).toBe(browserTempRoot)
    await expect.poll(() => existsSync(directory!)).toBe(false)
  },
  60_000,
)

test.skipIf(process.platform === 'win32')(
  'a deep data path supports short Unix IPC without moving payloads',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'browser-data-'))
    const deep = path.join(root, 'deep-data-path-'.repeat(8))
    await mkdir(deep)
    await writeFile(path.join(deep, 'keep.txt'), 'unowned sibling')
    const temp = await prepareBrowserTemp(deep)
    const socket = path.join(temp.temporary, 'org.chromium.Chromium.fixture', 'SingletonSocket')
    const server = createServer()
    try {
      await mkdir(path.dirname(socket))
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(socket, resolve)
      })
      await writeFile(path.join(temp.temporary, 'payload.bin'), Buffer.alloc(2 * 1024 * 1024))
      expect(await realpath(path.join(temp.temporary, 'payload.bin'))).toBe(
        path.join(temp.directory, 'payload.bin'),
      )
      expect(Buffer.byteLength(socket)).toBeLessThan(104)
    } finally {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
      await temp.remove()
    }
    expect(existsSync(temp.directory)).toBe(false)
    expect(existsSync(path.dirname(temp.temporary))).toBe(false)
    expect(await readFile(path.join(deep, 'keep.txt'), 'utf8')).toBe('unowned sibling')
    await rm(root, { recursive: true, force: true })
  },
)

test.skipIf(browserUnavailable || (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY))(
  'headed Chromium starts with a disk-backed private profile and isolated caller contexts',
  async () => {
    const before = new Set(await readdir(browserTempRoot).catch(() => []))
    const browser = await launchBrowser('chromium', true)
    let directory = ''
    let ipc = ''
    try {
      const created = (await readdir(browserTempRoot)).filter((entry) => !before.has(entry))
      expect(created).toHaveLength(1)
      directory = path.join(browserTempRoot, created[0]!)
      const socket = await readlink(path.join(directory, 'profile', 'SingletonSocket'))
      expect(Buffer.byteLength(socket)).toBeLessThan(104)
      ipc = path.dirname(path.dirname(path.dirname(socket)))
      const first = await browser.newContext()
      const second = await browser.newContext()
      await first.addCookies([
        { name: 'private', value: 'first', domain: 'fixture.test', path: '/' },
      ])
      expect(await second.cookies()).toEqual([])
      const page = await first.newPage()
      await page.setContent('<input aria-label="Owned launch input">')
      await page.getByRole('textbox', { name: 'Owned launch input' }).fill('started')
      expect(await page.getByRole('textbox', { name: 'Owned launch input' }).inputValue()).toBe(
        'started',
      )
    } finally {
      await browser.close()
    }
    await expect.poll(() => existsSync(directory)).toBe(false)
    await expect.poll(() => existsSync(ipc)).toBe(false)
  },
  60_000,
)
