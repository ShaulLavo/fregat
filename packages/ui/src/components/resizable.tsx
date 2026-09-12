import * as ResizablePrimitive from 'react-resizable-panels'
import { useMemo } from 'react'

import { cn } from '@workspace/ui/lib/utils'

const RESIZABLE_LAYOUT_STORAGE_PREFIX = 'platform.resizable-layout.'
const RESIZABLE_LAYOUT_STORAGE_VERSION = 1

type PersistedResizableLayoutPayload = {
  layout: ResizablePrimitive.Layout
  version: typeof RESIZABLE_LAYOUT_STORAGE_VERSION
}

type PersistedResizablePanelGroupProps = ResizablePrimitive.GroupProps & {
  storage?: ResizablePrimitive.LayoutStorage | null
  storageKey: string
}

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot='resizable-panel-group'
      className={cn('flex h-full w-full aria-[orientation=vertical]:flex-col', className)}
      {...props}
    />
  )
}

function PersistedResizablePanelGroup({
  defaultLayout,
  onLayoutChanged,
  storage,
  storageKey,
  ...props
}: PersistedResizablePanelGroupProps) {
  const persistedLayout = useMemo(
    () => readPersistedResizableLayout(storageKey, storage),
    [storage, storageKey],
  )

  function handleLayoutChanged(
    layout: ResizablePrimitive.Layout,
    meta: ResizablePrimitive.LayoutChangedMeta,
  ) {
    writePersistedResizableLayout(storageKey, layout, storage)
    onLayoutChanged?.(layout, meta)
  }

  return (
    <ResizablePanelGroup
      key={storageKey}
      defaultLayout={persistedLayout ?? defaultLayout}
      onLayoutChanged={handleLayoutChanged}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot='resizable-panel' {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot='resizable-handle'
      className={cn(
        'relative flex w-1 items-center justify-center bg-transparent ring-offset-background transition-colors after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 hover:bg-foreground/10 focus-visible:bg-foreground/15 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden aria-[orientation=horizontal]:h-1 aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-2 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[data-separator=active]]:bg-foreground/20 [&[data-separator=hover]]:bg-foreground/10',
        className,
      )}
      {...props}
    >
      {withHandle && (
        <>
          <div aria-hidden className='absolute -inset-1' />
          <div
            data-resizable-handle-indicator=''
            className='z-10 flex w-1 shrink-0 self-stretch bg-transparent'
          />
        </>
      )}
    </ResizablePrimitive.Separator>
  )
}

export function readPersistedResizableLayout(
  storageKey: string,
  storage?: ResizablePrimitive.LayoutStorage | null,
) {
  const layoutStorage = resolvedLayoutStorage(storage)
  if (!layoutStorage) return null

  try {
    return parsePersistedResizableLayout(
      layoutStorage.getItem(resizableLayoutStorageKey(storageKey)),
    )
  } catch {
    return null
  }
}

function writePersistedResizableLayout(
  storageKey: string,
  layout: ResizablePrimitive.Layout,
  storage?: ResizablePrimitive.LayoutStorage | null,
) {
  const layoutStorage = resolvedLayoutStorage(storage)
  if (!layoutStorage) return

  try {
    layoutStorage.setItem(
      resizableLayoutStorageKey(storageKey),
      JSON.stringify({
        layout,
        version: RESIZABLE_LAYOUT_STORAGE_VERSION,
      } satisfies PersistedResizableLayoutPayload),
    )
  } catch {
    // Ignore private-mode or quota failures; resizing should still work.
  }
}

function parsePersistedResizableLayout(value: string | null) {
  if (!value) return null

  try {
    return persistedResizableLayoutFromJson(JSON.parse(value) as unknown)
  } catch {
    return null
  }
}

function persistedResizableLayoutFromJson(value: unknown) {
  if (!isPersistedResizableLayoutPayload(value)) return null

  return value.layout
}

function isPersistedResizableLayoutPayload(
  value: unknown,
): value is PersistedResizableLayoutPayload {
  if (!isRecord(value)) return false
  if (value.version !== RESIZABLE_LAYOUT_STORAGE_VERSION) return false

  return isResizableLayout(value.layout)
}

function isResizableLayout(value: unknown): value is ResizablePrimitive.Layout {
  if (!isRecord(value)) return false

  return Object.values(value).every(isResizableLayoutSize)
}

function isResizableLayoutSize(value: unknown) {
  if (typeof value !== 'number') return false
  if (!Number.isFinite(value)) return false

  return value >= 0 && value <= 100
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value) return false

  return typeof value === 'object' && !Array.isArray(value)
}

function browserLayoutStorage() {
  try {
    if (typeof localStorage === 'undefined') return null

    return localStorage
  } catch {
    return null
  }
}

function resolvedLayoutStorage(storage: ResizablePrimitive.LayoutStorage | null | undefined) {
  if (storage !== undefined) return storage

  return browserLayoutStorage()
}

function resizableLayoutStorageKey(storageKey: string) {
  return `${RESIZABLE_LAYOUT_STORAGE_PREFIX}${storageKey}`
}

export { PersistedResizablePanelGroup, ResizableHandle, ResizablePanel, ResizablePanelGroup }

export type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels'
