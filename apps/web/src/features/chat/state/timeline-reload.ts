import * as v from 'valibot'
import { sessionIdSchema, type EnvironmentId } from '@workspace/contracts'
import type { ChatSession } from '@workspace/client-core/chat/types'
import type { VirtualListVirtualizer } from '@workspace/ui/patterns/virtual-list'
import { environmentWindowStorage } from '@/lib/environments/state/window-storage'
import { readReloadCache } from '@/lib/reload-cache'
import { writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'
import {
  chatTimelineItemEstimate,
  type ChatTimelineItem,
} from '@/features/chat/utils/timeline-items'
import {
  initialTimelineScrollState,
  resolveTimelineAnchorItemId,
  type TimelineScrollState,
  TIMELINE_TOP_INSET_PX,
  TIMELINE_COMPOSER_INSET_PX,
} from '@/features/chat/utils/timeline-scroll-anchoring'

const KEY = 'chat.timeline-view.v1'
const MAX_BYTES = 65_536
const finite = v.pipe(v.number(), v.finite())
const schema = v.object({
  sessionId: sessionIdSchema,
  anchorId: v.string(),
  anchorOffset: finite,
  followEnd: v.boolean(),
  width: v.pipe(finite, v.minValue(0)),
  height: v.pipe(finite, v.minValue(0)),
  typography: v.string(),
  rows: v.pipe(
    v.array(
      v.object({
        id: v.string(),
        generation: v.nullable(v.string()),
        size: v.pipe(finite, v.minValue(1)),
      }),
    ),
    v.maxLength(100),
  ),
  messageIds: v.pipe(v.array(v.string()), v.maxLength(40)),
})
export type TimelineReload = v.InferOutput<typeof schema>
const savedByEnvironment = new Map<EnvironmentId, TimelineReload | null>()

export function clearTimelineReload(environmentId: EnvironmentId) {
  savedByEnvironment.delete(environmentId)
  environmentWindowStorage(environmentId).removeItem(KEY)
}

export function readTimelineReload(environmentId: EnvironmentId) {
  if (savedByEnvironment.has(environmentId)) return savedByEnvironment.get(environmentId) ?? null
  const value = readReloadCache<TimelineReload>(
    KEY,
    schema,
    environmentWindowStorage(environmentId),
    MAX_BYTES,
  )
  savedByEnvironment.set(environmentId, value)
  return value
}

export function captureTimelineReload(
  environmentId: EnvironmentId,
  session: ChatSession,
  items: readonly ChatTimelineItem[],
  virtualizer: VirtualListVirtualizer,
  followEnd: boolean,
) {
  const element = virtualizer.scrollElement
  if (!element?.isConnected || items.length === 0) return
  const top = element.scrollTop
  const anchor = virtualizer.getVirtualItemForOffset(top)
  if (!anchor) return
  const item = items[anchor.index]
  if (!item) return
  const rowStart = Math.max(0, anchor.index - 20)
  const rowEnd = Math.min(items.length, anchor.index + 80)
  // TanStack's lazy measurement array materializes indexed reads, not Array.slice holes.
  const rows = Array.from(
    { length: rowEnd - rowStart },
    (_, index) => virtualizer.measurementsCache[rowStart + index],
  ).flatMap((row) => {
    if (!row) return []
    const value = items[row.index]
    return value
      ? [{ id: value.id, generation: timelineItemGeneration(value), size: row.size }]
      : []
  })
  const messageIds = items
    .slice(Math.max(0, anchor.index - 10), anchor.index + 30)
    .flatMap((value) => (value.type === 'message' ? [value.message.id] : []))
  const value: TimelineReload = {
    sessionId: session.id,
    anchorId: item.id,
    anchorOffset: top - anchor.start,
    followEnd,
    width: element.clientWidth,
    height: element.clientHeight,
    typography: timelineTypography(),
    rows,
    messageIds,
  }
  savedByEnvironment.set(environmentId, value)
}

export function flushTimelineReload(environmentId: EnvironmentId) {
  const value = savedByEnvironment.get(environmentId)
  if (!value) return
  writeWorkspaceCacheEntry(KEY, value, {
    storage: environmentWindowStorage(environmentId),
    maxSerializedBytes: MAX_BYTES,
  })
}

export function timelineInitialView(
  saved: TimelineReload | null,
  session: ChatSession,
  items: readonly ChatTimelineItem[],
) {
  if (!saved || saved.sessionId !== session.id || !items.some((item) => item.id === saved.anchorId))
    return null
  const compatible = saved.typography === timelineTypography()
  const sizes = new Map(saved.rows.map((row) => [row.id, row]))
  let start = TIMELINE_TOP_INSET_PX
  const measurements = items.map((item, index) => {
    const row = sizes.get(item.id)
    const size =
      compatible && row?.generation !== null && row?.generation === timelineItemGeneration(item)
        ? row.size
        : chatTimelineItemEstimate(item)
    const measurement = { index, key: item.id, start, size, end: start + size, lane: 0 }
    start += size
    return measurement
  })
  const anchor = measurements.find((row) => row.key === saved.anchorId)
  const offset = saved.followEnd
    ? Math.max(0, start + TIMELINE_COMPOSER_INSET_PX - saved.height)
    : Math.max(0, (anchor?.start ?? 0) + saved.anchorOffset)
  const scrollState: TimelineScrollState = {
    ...initialTimelineScrollState,
    sessionId: session.id,
    firstItemId: items[0]?.id ?? null,
    latestUserItemId: resolveTimelineAnchorItemId(items),
    followMode: saved.followEnd ? 'following-end' : 'free-scrolling',
  }
  return { offset, measurements, rect: { width: saved.width, height: saved.height }, scrollState }
}

function timelineTypography() {
  if (typeof document === 'undefined') return ''
  const style = getComputedStyle(document.documentElement)
  return `${window.innerWidth}:${style.fontFamily}:${style.fontSize}:${style.getPropertyValue('--density-row-height')}`
}

const generations = new WeakMap<object, string | null>()

function timelineItemGeneration(item: ChatTimelineItem): string | null {
  if (generations.has(item)) return generations.get(item) ?? null
  const value = measuredGeneration(item)
  generations.set(item, value)
  return value
}

function measuredGeneration(item: ChatTimelineItem): string | null {
  let text: string | null = null
  if (item.type === 'message') text = item.message.text
  if (item.type === 'proposed-plan') text = item.plan.planMarkdown
  if (text === null || text.length > 65_536) return null
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  return `${item.type}:${item.timestamp}:${hash >>> 0}`
}
