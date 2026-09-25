import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  providerSnapshotSchema,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderSnapshot,
} from '@workspace/contracts'
import * as v from 'valibot'
import { recordChatPipelineWarning } from '../orchestration/orchestration-logging'
import { platformHomePath } from '../home'

const DEFAULT_PROVIDER_STATUS_TTL_MS = 60_000

type CacheEntry = {
  checkedAtMs: number
  snapshot: ProviderSnapshot
}

export type ProviderStatusCacheOptions = {
  /**
   * Directory holding `<providerInstanceId>.json`. Absent keeps the cache
   * memory-only, which is what every test wants; the product registry passes
   * `defaultProviderStatusCacheDir()`.
   */
  directory?: string
  ttlMs?: number
}

/**
 * Blobs live beside the SQLite metadata database, same as attachments, so all
 * local platform state sits under one directory.
 */
export function defaultProviderStatusCacheDir() {
  return platformHomePath('provider-status')
}

/**
 * Two tiers. The in-memory tier is the TTL cache that keeps `/providers` off
 * the CLI probe path; the disk tier survives restarts so the first request
 * after boot renders immediately instead of blocking on a probe.
 *
 * A disk entry is only ever adopted when it names the same instance *and* the
 * same driver it is being read for: instance ids are user-editable, and a
 * renamed instance must not inherit another account's auth state.
 */
export class ProviderStatusCache {
  private readonly directory: string | null
  private readonly entries = new Map<string, CacheEntry>()
  private readonly ttlMs: number

  constructor(options: ProviderStatusCacheOptions = {}) {
    this.directory = options.directory ?? null
    this.ttlMs = options.ttlMs ?? DEFAULT_PROVIDER_STATUS_TTL_MS
  }

  get(instanceId: ProviderInstanceId) {
    const entry = this.entries.get(instanceId)
    if (!entry) return null
    if (Date.now() - entry.checkedAtMs > this.ttlMs) return null

    return entry.snapshot
  }

  /**
   * Cold-start seed: the snapshot the previous process left on disk. Returns
   * nothing once this process has probed at all — a live reading, however
   * stale, always beats a persisted one.
   */
  hydrate(instanceId: ProviderInstanceId, driverKind: ProviderDriverKind) {
    if (this.entries.has(instanceId)) return null

    return correlated(this.readFromDisk(instanceId), instanceId, driverKind)
  }

  /** Last known snapshot regardless of TTL. Used to diff availability. */
  last(instanceId: ProviderInstanceId, driverKind: ProviderDriverKind) {
    const remembered = this.entries.get(instanceId)?.snapshot ?? this.readFromDisk(instanceId)

    return correlated(remembered, instanceId, driverKind)
  }

  set(snapshot: ProviderSnapshot) {
    this.entries.set(snapshot.providerInstanceId, {
      checkedAtMs: Date.now(),
      snapshot,
    })
    this.writeToDisk(snapshot)
  }

  forget(instanceId: ProviderInstanceId) {
    this.entries.delete(instanceId)
  }

  private readFromDisk(instanceId: ProviderInstanceId) {
    const filePath = this.filePath(instanceId)
    if (!filePath) return null

    try {
      const parsed = v.safeParse(providerSnapshotSchema, JSON.parse(readFileSync(filePath, 'utf8')))
      if (parsed.success) return parsed.output
    } catch {
      // A missing file is the normal cold-start case; a corrupt one is treated
      // the same way — the probe result overwrites it on the next refresh.
      return null
    }

    return null
  }

  private writeToDisk(snapshot: ProviderSnapshot) {
    const filePath = this.filePath(snapshot.providerInstanceId)
    if (!filePath) return

    try {
      writeSnapshotFile(filePath, snapshot)
    } catch (error) {
      recordChatPipelineWarning('chat.pipeline.provider_status_cache.write.failed', {
        error,
        filePath,
        providerInstanceId: snapshot.providerInstanceId,
      })
    }
  }

  private filePath(instanceId: ProviderInstanceId) {
    if (!this.directory) return null

    return path.join(this.directory, `${instanceId}.json`)
  }
}

// Written through a temp file: a half-flushed snapshot read on the next
// boot would show the wrong account as signed in.
function writeSnapshotFile(filePath: string, snapshot: ProviderSnapshot) {
  const directory = path.dirname(filePath)
  mkdirSync(directory, { recursive: true })
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(snapshot)}\n`)
    renameSync(temporaryPath, filePath)
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

/**
 * Instance ids are user-editable and drivers can be swapped under one, so a
 * remembered snapshot is only usable when it names the same instance *and* the
 * same driver. Otherwise a rename would inherit another account's auth state.
 */
function correlated(
  snapshot: ProviderSnapshot | null,
  instanceId: ProviderInstanceId,
  driverKind: ProviderDriverKind,
) {
  if (!snapshot) return null
  if (snapshot.providerInstanceId !== instanceId) return null
  if (snapshot.driverKind !== driverKind) return null

  return snapshot
}
