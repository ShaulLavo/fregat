import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { recordDesktopInfo } from './observability'
import { groupAlive, processStart, signalGroup } from './processes'
import { desktopErrors } from './structured-errors'

type LeasedChild = { name: string; pid: number; startedAt: string; target: 'group' | 'process' }

// Children exit together at quit; unserialized read-modify-writes lose records and race the rename.
const writes = new Map<string, Promise<unknown>>()

function serialized<T>(file: string, change: () => Promise<T>) {
  const next = (writes.get(file) ?? Promise.resolve()).catch(() => {}).then(change)
  writes.set(file, next)
  return next
}

/**
 * The children one desktop checkout started, so a later launch can stop the ones
 * a crash left behind and nothing else. Each child leads its own process group,
 * so its pid is also the group that reaches helpers like Vite's node process.
 */
export function childLeaseFile(home: string, root: string) {
  return path.join(home, '.platform', 'desktop', `${Bun.hash(root).toString(36)}.json`)
}

export async function leaseChild(
  file: string,
  name: string,
  pid: number,
  target: LeasedChild['target'] = 'group',
) {
  const startedAt = await processStart(pid)
  if (!startedAt) return

  await serialized(file, async () => {
    const children = (await readLease(file)).filter((child) => child.pid !== pid)
    await writeLease(file, [...children, { name, pid, startedAt, target }])
  })
}

export function releaseChild(file: string, pid: number) {
  return serialized(file, async () => {
    const children = await readLease(file)
    const remaining = children.filter((child) => child.pid !== pid)
    if (remaining.length === children.length) return

    await writeLease(file, remaining)
  })
}

export function clearLease(file: string) {
  return serialized(file, () => rm(file, { force: true }))
}

/** Leased children still running as the process that was recorded, not a reused pid. */
async function liveLeasedChildren(file: string) {
  const children = await readLease(file)
  const starts = await Promise.all(children.map((child) => processStart(child.pid)))
  return children.filter((child, index) => starts[index] === child.startedAt)
}

/** Children a crashed desktop left running: only processes this checkout's lease recorded. */
export async function stopLeftoverChildren(file: string) {
  const leftovers = await liveLeasedChildren(file)
  if (leftovers.length > 0) await stopGroups(leftovers)
  await clearLease(file)
}

async function stopGroups(children: readonly LeasedChild[]) {
  recordDesktopInfo('desktop.leftovers.stop', { children })
  for (const child of children) signalChild(child, 'SIGTERM')
  if (await waitForGroupsExit(children, 2_500)) return

  // A live group keeps its id from being reused, so these are still ours.
  for (const child of children) signalChild(child, 'SIGKILL')
  if (await waitForGroupsExit(children, 2_500)) return

  const stuck = children.filter(childAlive)
  throw desktopErrors.LEFTOVER_RUNNING({
    names: stuck.map((child) => child.name),
    internal: { pids: stuck.map((child) => child.pid) },
  })
}

async function waitForGroupsExit(children: readonly LeasedChild[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (!children.some(childAlive)) return true

    await Bun.sleep(100)
  }

  return false
}

async function readLease(file: string): Promise<LeasedChild[]> {
  const text = await readFile(file, 'utf8').catch(() => null)
  if (text === null) return []

  const parsed: unknown = JSON.parse(text)
  if (!Array.isArray(parsed)) return []
  return parsed.filter(isLeasedChild)
}

async function writeLease(file: string, children: readonly LeasedChild[]) {
  if (children.length === 0) {
    await rm(file, { force: true })
    return
  }

  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(children))
  await rename(temporary, file)
}

function isLeasedChild(value: unknown): value is LeasedChild {
  if (typeof value !== 'object' || value === null) return false

  const record = value as Record<string, unknown>
  return (
    (record.target === 'group' || record.target === 'process') &&
    typeof record.name === 'string' &&
    Number.isInteger(record.pid) &&
    (record.pid as number) > 1 &&
    typeof record.startedAt === 'string' &&
    record.startedAt.length > 0
  )
}

function childAlive(child: LeasedChild) {
  if (child.target === 'group') return groupAlive(child.pid)
  try {
    process.kill(child.pid, 0)
    return true
  } catch {
    return false
  }
}

function signalChild(child: LeasedChild, signal: NodeJS.Signals) {
  if (child.target === 'group') return signalGroup(child.pid, signal)
  try {
    process.kill(child.pid, signal)
  } catch {
    // The process exited after the identity check.
  }
}
