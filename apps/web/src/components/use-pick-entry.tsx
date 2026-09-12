import { createClientInvariantError } from '@/lib/structured-errors'

import { FilePickerDialog, type FilePickerMode } from '@/components/file-picker-dialog'
import { errorMessage, statPath } from '@/lib/file-server'
import {
  isDirectoryEntry,
  isFileEntry,
  isPickedFsEntry,
  type PickedFsEntry,
} from '@/lib/file-system-types'
import { getPlatformBridge } from '@/lib/platform/bridge'
import { basenameFromOsPath, clientPathFromOsPath } from '@/components/utils/picked-path'
import { createWideEventScope } from '@/lib/wide-event-scope'
import type { WideEventScope } from '@workspace/observability/scope'
import { useEffect } from 'react'
import { toast } from 'sonner'

type UsePickEntryOptions = {
  accept?: readonly string[]
  mode?: FilePickerMode
  open: boolean
  value: PickedFsEntry | null
  onOpenChange: (open: boolean) => void
  onPick: (entry: PickedFsEntry) => void
}

let nativePickPromise: Promise<string | null> | null = null

export function usePickEntry({
  accept,
  mode = 'folder',
  open,
  value,
  onOpenChange,
  onPick,
}: UsePickEntryOptions) {
  const bridge = getPlatformBridge()

  useEffect(() => {
    if (!bridge) return
    if (!open) return

    let active = true
    const pickPromise = startNativePick({
      accept,
      bridge,
      mode,
      value,
    })
    void handleNativePickResult(pickPromise, {
      isActive: () => active,
      mode,
      onOpenChange,
      onPick,
    })

    return () => {
      active = false
    }
  }, [accept, bridge, mode, onOpenChange, onPick, open, value])

  if (bridge || !open) return null

  return (
    <FilePickerDialog
      accept={accept}
      mode={mode}
      onOpenChange={onOpenChange}
      onPick={onPick}
      open={open}
      value={value}
    />
  )
}

type PickNativeEntryOptions = {
  accept?: readonly string[]
  bridge: NonNullable<ReturnType<typeof getPlatformBridge>>
  mode: FilePickerMode
  value: PickedFsEntry | null
}

type NativePickResultHandlers = {
  isActive: () => boolean
  mode: FilePickerMode
  onOpenChange: (open: boolean) => void
  onPick: (entry: PickedFsEntry) => void
}

function startNativePick(options: PickNativeEntryOptions) {
  nativePickPromise ??= pickNativeEntry(options).finally(() => {
    nativePickPromise = null
  })

  return nativePickPromise
}

async function handleNativePickResult(
  pickPromise: Promise<string | null>,
  { isActive, mode, onOpenChange, onPick }: NativePickResultHandlers,
) {
  const startedAt = performance.now()
  const scope = createWideEventScope({
    action: 'platform.native_picker.summary',
    area: 'platform',
    mode,
  })
  const controller = new AbortController()
  const path = await selectedNativePath(pickPromise, isActive, scope)
  if (!isActive()) {
    scope.end({ aborted: true, durationMs: elapsedMs(startedAt) })
    return
  }
  if (!path) {
    if (scope.count('picker.errorCount') === 0) scope.set({ outcome: 'cancelled' })
    scope.end({ durationMs: elapsedMs(startedAt) })
    onOpenChange(false)
    return
  }

  try {
    scope.increment('picker.selectedCount')
    scope.set({ path })
    const entry = await hydratePickedEntry(path, controller.signal)
    if (!isActive()) {
      scope.end({ aborted: true, durationMs: elapsedMs(startedAt) })
      return
    }

    assertEntryMatchesMode(entry, mode)
    scope.increment('picker.hydratedCount')
    scope.set({ entryType: entry.type, outcome: 'ok' })
    onPick(entry)
  } catch (error) {
    if (!isActive()) return

    scope.increment('picker.errorCount')
    scope.warn('Native picker entry hydration failed.', { error })
    scope.set({ outcome: 'error' })
    toast.error('Could not open selected path', {
      description: errorMessage(error),
    })
  } finally {
    scope.end({ durationMs: elapsedMs(startedAt) })
    if (isActive()) onOpenChange(false)
  }
}

async function selectedNativePath(
  pickPromise: Promise<string | null>,
  isActive: () => boolean,
  scope: WideEventScope,
): Promise<string | null> {
  try {
    return await pickPromise
  } catch (error) {
    if (isActive()) {
      scope.increment('picker.errorCount')
      scope.warn('Native picker failed.', { message: errorMessage(error) })
      scope.set({ outcome: 'error' })
    }

    return null
  }
}

async function pickNativeEntry({
  accept,
  bridge,
  mode,
  value,
}: PickNativeEntryOptions): Promise<string | null> {
  const paths = await bridge.pickEntry({ accept, mode, startingPath: value?.path })
  const path = paths[0]
  if (!path) return null

  return path
}

function assertEntryMatchesMode(entry: PickedFsEntry, mode: FilePickerMode) {
  if (mode === 'folder' && isDirectoryEntry(entry)) return
  if (mode === 'file' && isFileEntry(entry)) return

  throw createClientInvariantError(
    mode === 'folder' ? 'Picked path is not a folder.' : 'Picked path is not a file.',
  )
}

function elapsedMs(startedAt: number) {
  return Math.round((performance.now() - startedAt) * 100) / 100
}

async function hydratePickedEntry(path: string, signal: AbortSignal): Promise<PickedFsEntry> {
  const statInput = clientPathFromOsPath(path)
  const entry = {
    ...(await statPath(statInput, signal)),
    name: basenameFromOsPath(path),
  }

  if (isPickedFsEntry(entry)) return entry

  throw createClientInvariantError(`Picked path is not a file or directory: ${path}`)
}
