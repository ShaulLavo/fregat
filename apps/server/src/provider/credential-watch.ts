import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import type { ProviderInstanceId } from '@workspace/contracts'
import { recordChatPipelineInfo } from '../observability/chat-pipeline'

/** Coalesces the burst of events a CLI emits while rewriting its credentials file. */
const CREDENTIAL_CHANGE_DEBOUNCE_MS = 150

type WatchedDirectory = {
  fileNames: Set<string>
  instanceIds: Set<ProviderInstanceId>
  watcher: FSWatcher
}

/**
 * Watches the credential files declared by each driver so an out-of-band
 * `codex login` in a terminal moves the provider from unauthenticated to
 * authenticated within a second, with no restart and no polling.
 *
 * The *directory* is watched, not the file: a signed-out instance has no
 * credentials file yet, and creating one is precisely the event we must not
 * miss. Instances are keyed per directory because two instances can legally
 * share a home.
 */
export class ProviderCredentialWatch {
  private readonly directories = new Map<string, WatchedDirectory>()
  private readonly dirty = new Set<ProviderInstanceId>()
  private readonly onChanged: (instanceIds: ProviderInstanceId[]) => void
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(onChanged: (instanceIds: ProviderInstanceId[]) => void) {
    this.onChanged = onChanged
  }

  /** Replaces the whole watch set; call after every reconcile. */
  reset(
    entries: ReadonlyArray<{ paths: readonly string[]; providerInstanceId: ProviderInstanceId }>,
  ) {
    this.stop()
    for (const entry of entries) {
      for (const credentialPath of entry.paths) {
        this.watchPath(entry.providerInstanceId, credentialPath)
      }
    }
  }

  stop() {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    this.dirty.clear()
    for (const directory of this.directories.values()) {
      directory.watcher.close()
    }
    this.directories.clear()
  }

  private watchPath(providerInstanceId: ProviderInstanceId, credentialPath: string) {
    const directoryPath = path.dirname(credentialPath)
    const fileName = path.basename(credentialPath)
    const existing = this.directories.get(directoryPath)
    if (existing) {
      existing.fileNames.add(fileName)
      existing.instanceIds.add(providerInstanceId)
      return
    }

    const watcher = this.openWatcher(directoryPath)
    if (!watcher) return

    this.directories.set(directoryPath, {
      fileNames: new Set([fileName]),
      instanceIds: new Set([providerInstanceId]),
      watcher,
    })
  }

  private openWatcher(directoryPath: string) {
    try {
      const watcher = watch(directoryPath, (_event, changed) => {
        this.handleEvent(directoryPath, changed)
      })
      // A watcher must never be the reason the process stays alive.
      watcher.unref()
      watcher.on('error', () => watcher.close())

      return watcher
    } catch {
      // The home has not been created yet — nothing to sign in with, so there
      // is nothing to observe until the next reconcile.
      return null
    }
  }

  private handleEvent(directoryPath: string, changed: string | Buffer | null) {
    const directory = this.directories.get(directoryPath)
    if (!directory) return

    const fileName = typeof changed === 'string' ? changed : changed?.toString()
    // A null filename means "something in here changed"; treat it as a hit
    // rather than dropping a real sign-in on a platform that omits the name.
    if (fileName && !directory.fileNames.has(fileName)) return

    for (const instanceId of directory.instanceIds) {
      this.dirty.add(instanceId)
    }
    this.scheduleFlush()
  }

  private scheduleFlush() {
    if (this.flushTimer) return

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      const instanceIds = Array.from(this.dirty)
      this.dirty.clear()
      if (instanceIds.length === 0) return

      recordChatPipelineInfo('chat.pipeline.provider_credentials.changed', {
        providerInstanceIds: instanceIds,
      })
      this.onChanged(instanceIds)
    }, CREDENTIAL_CHANGE_DEBOUNCE_MS)
    this.flushTimer.unref?.()
  }
}
