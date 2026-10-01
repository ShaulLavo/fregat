import { existsSync } from 'node:fs'
import { readFile, readdir, readlink } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from 'vitest'
import { browserTempRoot, launchBrowser } from './browser-launch'

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
test.skipIf(process.platform !== 'linux')(
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
