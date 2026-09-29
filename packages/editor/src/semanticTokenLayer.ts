import { projectDecorationRangeThroughEdits } from './editor/decorationStore'
import type {
  EditorTrackedRanges,
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from './plugins'
import type { EditorDisposable } from './editor/disposables'
import {
  createSemanticTokenStyles,
  type SemanticTokenDropReason,
  type SemanticTokenPayload,
  type SemanticTokenPushResult,
  type SemanticTokenRangeRequest,
  type SemanticTokenSpan,
  type SemanticTokenStyles,
} from './syntax'
import type { VirtualizedTextHighlightStyle } from './virtualization/virtualizedTextViewInternals'

/**
 * Where the semantic layer sits in the shared highlight priority space.
 *
 * Priority only decides between highlights that declare the *same* property — the CSS Custom
 * Highlight API resolves per property — so the only contest here is for `color`, and five producers
 * declare one: syntax token highlights at 0, bracket depth colouring at 1, this layer, an error
 * diagnostic, and the current find match. Semantic colour must beat the syntactic colour it refines
 * and the depth colour that refines it in turn, and must lose to an error squiggle and to the
 * current find match, which are both answers to a question the user just asked.
 *
 * Two rather than one because bracket depth colouring already held one, and a tie in this namespace
 * is resolved by registry insertion order — which is the defect the band exists to remove, not a
 * place to leave one. `packages/lsp-plugin/test/highlightPriority.test.ts` holds the whole order.
 */
export const SEMANTIC_TOKEN_Z_INDEX = 2

/**
 * Which edge absorbs text typed against a painted span, and which does not.
 *
 * A semantic span describes a symbol the server has already classified. A character typed
 * immediately *before* an identifier is not part of it; a character typed immediately *after* it
 * changes what the identifier is, and the server has not been asked yet. Holding the span to what
 * was actually described — kept and shrunk rather than grown — means the new character shows
 * syntactic colour for one request window instead of showing semantic colour nobody granted it.
 *
 * Named explicitly rather than inherited: `trackRanges` defaults to `{left, right}` — "a region of
 * the document" — which is the opposite of what a described span wants. The diagnostics path records
 * the same pair for the same window and the same reason, deliberately.
 */
const SEMANTIC_TOKEN_STICKINESS = { startBias: 'right', endBias: 'left' } as const

export type SemanticTokenLayerOptions = {
  /** Namespaces the layer's highlight groups within the view. */
  readonly name: string
  /** See SemanticTokenStyleOptions.scopeAliases — host data, per server. */
  readonly scopeAliases?: Readonly<Record<string, string>>
  /**
   * Trailing debounce applied to `onRangeNeeded`, in milliseconds.
   *
   * **No default: unset means zero, and zero means the editor adds no delay of its own.** The number
   * is the host's, because the host is the side that can measure real servers over a real transport
   * — and two debounces stacked on one signal is a latency neither side budgets.
   */
  readonly viewportDelayMs?: number
  readonly onRangeNeeded?: (request: SemanticTokenRangeRequest) => void
  readonly onResyncRequired?: (reason: SemanticTokenDropReason) => void
}

export type SemanticTokenLayer = EditorDisposable & {
  /**
   * Paints a decoded payload, and says what happened. The verdict is returned rather than swallowed
   * because a host that cannot see its payload was dropped will sit on a stale `resultId` forever.
   */
  push(payload: SemanticTokenPayload): SemanticTokenPushResult
  /** Empties every group the layer owns. A dropped payload does *not* do this; only this call does. */
  clear(): void
}

/** What the view contribution that owns a layer holds. A host is handed the narrower type above. */
export type SemanticTokenLayerController = SemanticTokenLayer & {
  update(snapshot: EditorViewSnapshot, kind: EditorViewContributionUpdateKind): void
}

/** Update kinds that can move the visible offset range, or the text inside it. */
const DEMAND_KINDS: ReadonlySet<EditorViewContributionUpdateKind> = new Set([
  'document',
  'content',
  'viewport',
  'layout',
])

type PaintedGroup = {
  readonly name: string
  readonly style: VirtualizedTextHighlightStyle
  ranges: { start: number; end: number }[]
  /**
   * One tracked set per group rather than one for the whole payload, because `resolve()` drops the
   * ranges whose text is gone and so cannot be indexed back onto a parallel array of styles.
   */
  tracked: EditorTrackedRanges | null
}

/**
 * Semantic colour, painted as range highlights over the syntactic layer.
 *
 * Deliberately *not* merged into the token store. A semantic span sits inside the syntactic token it
 * recolours, and a store whose ends do not grow with its starts is kept as one flat run, so every
 * keystroke would copy the document's tokens instead of sharing them. The range-highlight layer is
 * the second layer the view already composes: it stacks by declared `zIndex`, paints only over
 * mounted rows by bisection, and skips redundant updates by signature.
 *
 * The price is that semantic colour does not reach the minimap, sticky scroll or the diff panes.
 * Those views hold their own `VirtualizedTextView` and read colour from `snapshot.tokens`; a
 * range-highlight layer is not a token. That is a product decision, not an oversight — the only
 * shape that would fix it is a genuine second token store, which costs an overlay term in the
 * per-row skip signature and overlay-aware segment composition.
 */
export function createSemanticTokenLayer(
  context: EditorViewContributionContext,
  options: SemanticTokenLayerOptions,
): SemanticTokenLayerController {
  const styles: SemanticTokenStyles = createSemanticTokenStyles({
    scopeAliases: options.scopeAliases,
    zIndex: SEMANTIC_TOKEN_Z_INDEX,
  })
  const prefix = context.highlightPrefix
  // Keyed by resolved style rather than by scope name, and the index is remembered for the layer's
  // life: the live group count is then the number of distinct semantic *colours* the viewport holds,
  // which is a property of the theme and not of the server. A fifty-type legend still collapses to a
  // handful of groups, and a repaint never renames one.
  const groupNames = new Map<string, string>()
  let painted = new Map<string, PaintedGroup>()

  let lastRequest = ''
  let demandTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  const syncPointsByTextVersion = new Map<number, EditorViewSnapshot['documentSyncPoint']>()
  /** The document the painted groups and their anchors belong to. See the check in `update`. */
  let paintedDocumentId: string | null = null

  const groupNameFor = (styleKey: string): string => {
    const existing = groupNames.get(styleKey)
    if (existing) return existing

    const name = `${prefix}${options.name}-${groupNames.size}`
    groupNames.set(styleKey, name)
    return name
  }

  const clearPainted = (): void => {
    for (const group of painted.values()) context.clearRangeHighlight(group.name)
    painted = new Map()
    paintedDocumentId = null
  }

  const cancelDemand = (): void => {
    if (demandTimer === null) return

    clearTimeout(demandTimer)
    demandTimer = null
  }

  const fireDemand = (request: SemanticTokenRangeRequest): void => {
    if (options.viewportDelayMs === undefined || options.viewportDelayMs <= 0) {
      options.onRangeNeeded?.(request)
      return
    }

    cancelDemand()
    /**
     * @justification Coalesces the demand signal against the viewport rather than against
     * rendering. `'viewport'` is fired once per scroll event and is not throttled at source, so a
     * flung scroll is one update per frame; `cancel()` on every input is what turns that into one
     * question per pause. The delay itself is the host's number — this editor names none.
     */
    demandTimer = setTimeout(() => {
      demandTimer = null
      options.onRangeNeeded?.(request)
    }, options.viewportDelayMs)
  }

  const paintPayload = (
    payload: SemanticTokenPayload,
    snapshot: EditorViewSnapshot,
  ): SemanticTokenPushResult => {
    if (payload.textVersion > snapshot.textVersion) return dropped('version-ahead', options)
    if (payload.textVersion === snapshot.textVersion) return paint(payload.spans, snapshot, 0)

    // The text moved between the request and the answer, which is the ordinary case rather than the
    // exception. The edit chain keeps a bounded number of transitions and returns null for one it
    // can no longer reach — a slow cold server plus fast typing gets there — so the resync branch is
    // not hypothetical and a host has to implement it.
    const point = syncPointsByTextVersion.get(payload.textVersion)
    if (!point) return dropped('version-too-old', options)
    const changes = snapshot.changesSinceDocumentSyncPoint(point, null)
    if (!changes?.edits) return dropped('version-too-old', options)

    return paint(projectSpans(payload.spans, changes.edits), snapshot, changes.edits.length)
  }

  return {
    update(snapshot, kind) {
      if (disposed) return
      syncPointsByTextVersion.set(snapshot.textVersion, snapshot.documentSyncPoint)
      trimSyncPoints(syncPointsByTextVersion)
      if (kind === 'clear') {
        cancelDemand()
        clearPainted()
        return
      }

      /**
       * A layer never spans two documents. `SemanticTokenLayerOwner` enforces that by disposing this
       * one and handing the host a new one, but `createSemanticTokenLayer` is public and a caller
       * that holds a single layer across a document switch would otherwise keep the previous file's
       * spans painted — and keep re-anchoring them, because a tracked range built against one piece
       * table resolves against another to a live offset rather than to nothing. That is the failure
       * §C5's document check exists to prevent, reached from the side `push` cannot see.
       */
      if (paintedDocumentId !== null && snapshot.documentId !== paintedDocumentId) {
        clearPainted()
      }

      // Repaint from the anchors before anything else: the offsets the last payload was painted at
      // address text that has since moved, and until a fresh one lands they are what the reader
      // sees. Find does exactly this on every content update and defers only its re-search, which
      // is the expensive half; deferring the repaint instead would leave colour trailing the text
      // by however many characters the delay covered.
      if (kind === 'content') repaintFromAnchors()
      if (!options.onRangeNeeded) return
      if (!DEMAND_KINDS.has(kind)) return

      const request = visibleRangeRequest(snapshot)
      if (!request) return

      // At most one call per update, and none at all when nothing that matters has moved: a caret
      // moving inside an unchanged viewport is not a new question.
      const signature = `${request.documentId}:${request.textVersion}:${request.start}:${request.end}`
      if (signature === lastRequest) return

      lastRequest = signature
      fireDemand(request)
    },

    push(payload) {
      if (disposed) return dropped('document-changed', options)

      const snapshot = context.getSnapshot()
      if (snapshot.documentId !== payload.documentId) {
        return dropped('document-changed', options)
      }
      if (payload.textVersion > snapshot.textVersion) return dropped('version-ahead', options)
      return paintPayload(payload, snapshot)
    },

    clear() {
      clearPainted()
    },

    dispose() {
      if (disposed) return

      disposed = true
      cancelDemand()
      clearPainted()
    },
  }

  function repaintFromAnchors(): void {
    for (const group of painted.values()) {
      const resolved = group.tracked?.resolve()
      if (!resolved) continue

      const ranges = resolved.map((range) => ({ end: range.end, start: range.start }))
      if (sameRanges(group.ranges, ranges)) continue

      group.ranges = ranges
      if (ranges.length === 0) context.clearRangeHighlight(group.name)
      else context.setRangeHighlight(group.name, ranges, group.style)
    }
  }

  function paint(
    spans: readonly SemanticTokenSpan[],
    snapshot: EditorViewSnapshot,
    projectedThroughEdits: number,
  ): SemanticTokenPushResult {
    const textLength = snapshot.textSnapshot.length
    const unresolved = new Set<string>()
    const groups = new Map<string, PaintedGroup>()
    let paintedSpans = 0

    for (const span of normalizeSpans(spans, textLength)) {
      const style = styles.resolve(span.tokenType, span.tokenModifiers)
      if (!style) {
        unresolved.add(span.tokenType)
        continue
      }

      const styleKey = highlightStyleKey(style)
      const group = groups.get(styleKey) ?? {
        name: groupNameFor(styleKey),
        ranges: [],
        style,
        tracked: null,
      }
      group.ranges.push({ end: span.end, start: span.start })
      groups.set(styleKey, group)
      paintedSpans += 1
    }

    // A group that painted last time and holds nothing now has to be cleared explicitly: an empty
    // set of ranges is not the same message as "leave what is there".
    for (const [styleKey, group] of painted) {
      if (!groups.has(styleKey)) context.clearRangeHighlight(group.name)
    }
    for (const group of groups.values()) {
      context.setRangeHighlight(group.name, group.ranges, group.style)
      // Anchors are a property of the buffer, so a batch edit, a multi-cursor run, a formatter
      // response and a Replace All all resolve correctly — which single-edit offset projection
      // cannot do.
      group.tracked = context.trackRanges(group.ranges, SEMANTIC_TOKEN_STICKINESS)
    }
    painted = groups
    paintedDocumentId = snapshot.documentId

    return {
      paintedSpans,
      projectedThroughEdits,
      status: 'painted',
      unresolvedTypeNames: [...unresolved],
    }
  }
}

function trimSyncPoints(points: Map<number, EditorViewSnapshot['documentSyncPoint']>): void {
  while (points.size > 128) {
    const oldest = points.keys().next().value
    if (oldest === undefined) return
    points.delete(oldest)
  }
}

/**
 * Carries a payload the text has already moved past onto where that text went.
 *
 * Same bias pair as the anchors, so a span projected through five edits and a span that was anchored
 * across the same five end up in the same place. A span whose text is gone is dropped rather than
 * collapsed onto the edit site.
 */
function projectSpans(
  spans: readonly SemanticTokenSpan[],
  edits: readonly { readonly from: number; readonly to: number; readonly text: string }[],
): readonly SemanticTokenSpan[] {
  const projected: SemanticTokenSpan[] = []
  for (const span of spans) {
    const range = projectDecorationRangeThroughEdits(
      { end: span.end, start: span.start, ...SEMANTIC_TOKEN_STICKINESS },
      edits,
    )
    if (!range) continue

    projected.push({ ...span, end: range.end, start: range.start })
  }

  return projected
}

function sameRanges(
  left: readonly { readonly start: number; readonly end: number }[],
  right: readonly { readonly start: number; readonly end: number }[],
): boolean {
  if (left.length !== right.length) return false

  return left.every((range, index) => {
    const other = right[index]
    return other !== undefined && other.start === range.start && other.end === range.end
  })
}

function dropped(
  reason: SemanticTokenDropReason,
  options: SemanticTokenLayerOptions,
): SemanticTokenPushResult {
  options.onResyncRequired?.(reason)
  return { reason, status: 'dropped' }
}

/**
 * Server data is untrusted input, so the editor normalises unconditionally rather than trusting a
 * host's claim to have done it: spans arrive in any order, zero-length ones cannot paint, offsets
 * past the end of the text are a real thing servers send, and overlaps are not supported.
 *
 * Where two spans overlap the more specific one wins — later `start`, or the shorter of two that
 * begin together — because LSP's `overlappingTokenSupport` defaults to false and this editor does
 * not honour it. That is also why the capability builder cannot declare it.
 *
 * The loser is **truncated, not discarded**. A span nested inside another comes back as the outer's
 * head, the inner, and the outer's tail: three spans covering exactly the characters the two
 * described. Popping the outer and keeping only its head — which is what a single-element lookback
 * does — silently dropped everything after the nested span, so a server that marked one
 * interpolation inside a template literal lost the rest of the literal's colour and `paintedSpans`
 * reported a clean paint.
 */
function normalizeSpans(
  spans: readonly SemanticTokenSpan[],
  textLength: number,
): readonly SemanticTokenSpan[] {
  const clamped: SemanticTokenSpan[] = []
  for (const span of spans) {
    const start = clampOffset(span.start, textLength)
    const end = clampOffset(span.end, textLength)
    if (end <= start) continue

    clamped.push(span.start === start && span.end === end ? span : { ...span, end, start })
  }

  clamped.sort((left, right) => left.start - right.start || left.end - right.end)
  // The conformant case, and the one worth keeping free: a non-overlapping set is already the
  // answer, so nothing below it allocates.
  if (!hasOverlappingSpan(clamped)) return clamped

  return resolveOverlappingSpans(clamped)
}

function hasOverlappingSpan(sorted: readonly SemanticTokenSpan[]): boolean {
  let maxEnd = -1
  for (const span of sorted) {
    if (span.start < maxEnd) return true
    maxEnd = span.end > maxEnd ? span.end : maxEnd
  }

  return false
}

/**
 * One owner per character, then contiguous runs of one owner rejoined into a span.
 *
 * Same sweep the capture resolver runs, with "most specific" spelled in offsets rather than in
 * scope names, because there is no ranking to appeal to here — the spans come from one server's
 * legend and carry no relative authority.
 */
function resolveOverlappingSpans(
  sorted: readonly SemanticTokenSpan[],
): readonly SemanticTokenSpan[] {
  const boundaries = spanBoundaries(sorted)
  const resolved: SemanticTokenSpan[] = []
  const active: SemanticTokenSpan[] = []
  let admitted = 0
  let owner: SemanticTokenSpan | null = null

  for (let index = 0; index + 1 < boundaries.length; index += 1) {
    const start = boundaries[index] as number
    const end = boundaries[index + 1] as number
    admitted = admitSpans(sorted, admitted, start, active)
    evictClosedSpans(active, start)

    const winner = innermostSpan(active)
    if (!winner) {
      owner = null
      continue
    }

    const previous = resolved[resolved.length - 1]
    if (owner === winner && previous && previous.end === start) {
      resolved[resolved.length - 1] = { ...previous, end }
      continue
    }

    owner = winner
    resolved.push(winner.start === start && winner.end === end ? winner : { ...winner, end, start })
  }

  return resolved
}

function spanBoundaries(spans: readonly SemanticTokenSpan[]): number[] {
  const offsets: number[] = []
  for (const span of spans) offsets.push(span.start, span.end)
  offsets.sort((left, right) => left - right)

  const boundaries: number[] = []
  for (const offset of offsets) {
    if (boundaries[boundaries.length - 1] === offset) continue
    boundaries.push(offset)
  }

  return boundaries
}

function admitSpans(
  sorted: readonly SemanticTokenSpan[],
  cursor: number,
  offset: number,
  active: SemanticTokenSpan[],
): number {
  let next = cursor
  while (next < sorted.length && (sorted[next] as SemanticTokenSpan).start <= offset) {
    active.push(sorted[next] as SemanticTokenSpan)
    next += 1
  }

  return next
}

function evictClosedSpans(active: SemanticTokenSpan[], offset: number): void {
  let kept = 0
  for (const span of active) {
    if (span.end <= offset) continue

    active[kept] = span
    kept += 1
  }

  active.length = kept
}

/** Latest to begin, and the shorter of two that begin together. Ties go to the earlier arrival. */
function innermostSpan(active: readonly SemanticTokenSpan[]): SemanticTokenSpan | null {
  let best: SemanticTokenSpan | null = null
  for (const span of active) {
    if (best && !isInnerSpan(span, best)) continue
    best = span
  }

  return best
}

function isInnerSpan(span: SemanticTokenSpan, incumbent: SemanticTokenSpan): boolean {
  if (span.start !== incumbent.start) return span.start > incumbent.start
  return span.end < incumbent.end
}

function clampOffset(offset: number, textLength: number): number {
  if (!Number.isFinite(offset) || offset < 0) return 0
  return offset > textLength ? textLength : offset
}

/** The four fields `sameHighlightStyle` compares, which is what makes two spans one group. */
function highlightStyleKey(style: VirtualizedTextHighlightStyle): string {
  return JSON.stringify([style.color, style.backgroundColor, style.textDecoration, style.zIndex])
}

function visibleRangeRequest(snapshot: EditorViewSnapshot): SemanticTokenRangeRequest | null {
  const documentId = snapshot.documentId
  if (documentId === null) return null

  const first = snapshot.visibleRows[0]
  const last = snapshot.visibleRows.at(-1)
  if (!first || !last) return null

  return {
    documentId,
    end: last.endOffset,
    start: first.startOffset,
    textVersion: snapshot.textVersion,
  }
}
