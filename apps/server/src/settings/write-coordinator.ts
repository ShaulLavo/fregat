import { realpathSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { isRecord } from '@workspace/contracts'

type Waiter = {
  readonly ready: () => void
}

type Coordinator = {
  held: boolean
  references: number
  readonly waiters: Waiter[]
}

export type SettingsWriteLease = {
  readonly canonicalPath: string
  readonly waitMs: number
  release(): void
}

const coordinators = new Map<string, Coordinator>()

/**
 * Serializes every in-process writer of one canonical settings path.
 *
 * Missing files are keyed through their nearest existing real parent so a
 * symlink spelling cannot acquire one lock before creation and another after.
 */
async function acquireSettingsWriteLease(filePath: string): Promise<SettingsWriteLease> {
  const canonicalPath = await canonicalSettingsPath(filePath)
  const coordinator = coordinatorFor(canonicalPath)
  const startedAt = performance.now()
  coordinator.references += 1

  if (coordinator.held) await waitForCoordinator(coordinator)
  coordinator.held = true

  let released = false
  return {
    canonicalPath,
    waitMs: elapsedMs(startedAt),
    release: () => {
      if (released) return

      released = true
      releaseCoordinator(canonicalPath, coordinator)
    },
  }
}

export async function withSettingsWriteCoordinator<T>(
  filePath: string,
  operation: (lease: SettingsWriteLease) => Promise<T>,
): Promise<T> {
  const lease = await acquireSettingsWriteLease(filePath)

  try {
    return await operation(lease)
  } finally {
    lease.release()
  }
}

async function canonicalSettingsPath(filePath: string): Promise<string> {
  const absolute = path.resolve(filePath)
  const unresolved: string[] = []
  let candidate = absolute

  while (true) {
    const resolved = await realpath(candidate).catch((error) => {
      if (isMissingPath(error)) return null
      throw error
    })
    if (resolved) return path.join(resolved, ...unresolved.reverse())

    const parent = path.dirname(candidate)
    if (parent === candidate) return path.normalize(absolute)

    unresolved.push(path.basename(candidate))
    candidate = parent
  }
}

export function canonicalSettingsPathSync(filePath: string): string {
  const absolute = path.resolve(filePath)
  const unresolved: string[] = []
  let candidate = absolute

  while (true) {
    const resolved = syncRealpath(candidate)
    if (resolved) return path.join(resolved, ...unresolved.reverse())

    const parent = path.dirname(candidate)
    if (parent === candidate) return path.normalize(absolute)

    unresolved.push(path.basename(candidate))
    candidate = parent
  }
}

function syncRealpath(candidate: string) {
  try {
    return realpathSync(candidate)
  } catch (error) {
    if (isMissingPath(error)) return null
    throw error
  }
}

function isMissingPath(error: unknown) {
  if (!isRecord(error)) return false

  return error.code === 'ENOENT' || error.code === 'ENOTDIR'
}

/** Test-only visibility for proving idle coordinators do not leak. */
export function activeSettingsWriteCoordinatorCount(): number {
  return coordinators.size
}

function coordinatorFor(canonicalPath: string): Coordinator {
  const existing = coordinators.get(canonicalPath)
  if (existing) return existing

  const created: Coordinator = { held: false, references: 0, waiters: [] }
  coordinators.set(canonicalPath, created)

  return created
}

function waitForCoordinator(coordinator: Coordinator): Promise<void> {
  return new Promise((ready) => coordinator.waiters.push({ ready }))
}

function releaseCoordinator(canonicalPath: string, coordinator: Coordinator) {
  coordinator.references -= 1
  const next = coordinator.waiters.shift()
  if (next) {
    next.ready()
    return
  }

  coordinator.held = false
  if (coordinator.references === 0) coordinators.delete(canonicalPath)
}

function elapsedMs(startedAt: number) {
  return Math.round((performance.now() - startedAt) * 100) / 100
}
