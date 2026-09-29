import type {
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import type { EditorTheme } from '@singapore-editor/core/rendering'

import { EDITOR_SNIPPET_TOKENS_FEATURE } from '@singapore-editor/core/extensions'

import { anchoredSurfaceFollowsUpdate } from './anchoredSurface'
import { createTooltipCodeTokenizer, type TooltipCodeBlock } from './codeTokens'
import { tooltipCodeBlocks } from './markdownTooltip'
import type {
  EditorHoverParticipant,
  HoverAnchor,
  HoverPart,
  HoverRequest,
} from './hoverParticipant'
import { EDITOR_HOVER_PARTICIPANT } from './hoverToken'
import { hoverTargetRangeInSource, sameOffsetRange, unionOffsetRange } from './offsetRange'
import {
  createTooltipController,
  HOVER_ASYNC_DISPATCH_DELAY_MS,
  HOVER_LOADING_DELAY_MS,
  HOVER_REQUEST_DEBOUNCE_MS,
  type TooltipController,
} from './tooltip'

export type HoverControllerOptions = {
  readonly context: EditorViewContributionContext
  readonly classNamespace?: string
  readonly markdownCodeBackground?: boolean
}

export type HoverController = {
  update(snapshot: EditorViewSnapshot, kind: EditorViewContributionUpdateKind): void
  /** Shows the hover at an offset right away, as a keyboard summons does. */
  showAtOffset(offset: number, options?: { readonly focus?: boolean }): boolean
  hide(): void
  containsTarget(target: EventTarget | null): boolean
  dispose(): void
}

type ParticipantResult = {
  sync: readonly HoverPart[]
  async: readonly HoverPart[]
}

type HoverOperation = {
  readonly id: number
  readonly anchor: HoverAnchor
  readonly snapshot: EditorViewSnapshot
  readonly participants: readonly EditorHoverParticipant[]
  readonly results: Map<EditorHoverParticipant, ParticipantResult>
  readonly abort: AbortController
  readonly focusOnShow: boolean
  pendingAsync: number
  revealed: boolean
  loading: boolean
  shown: boolean
  dispatchTimer: ReturnType<typeof setTimeout> | null
  revealTimer: ReturnType<typeof setTimeout> | null
  loadingTimer: ReturnType<typeof setTimeout> | null
}

/**
 * The one hover an editor view has.
 *
 * Every plugin with something to say at a position registers an EditorHoverParticipant; this asks
 * all of them on one clock and paints their answers in one surface. Two plugins can therefore never
 * put two hovers on screen, and neither can open on a different delay than the other: the timing
 * is not theirs to set.
 *
 * The clock is VS Code's. With a 300ms delay, async work starts at 150ms so a server answer
 * overlaps the rest of the dwell, sync work runs and the surface paints at 300ms, and a hover still
 * waiting on a server at 900ms shows a loading row.
 */
export function createHoverController(options: HoverControllerOptions): HoverController {
  const { context } = options
  const element = context.scrollElement
  const ownerDocument = context.container.ownerDocument
  let operation: HoverOperation | null = null
  let nextOperationId = 0
  let theme: EditorTheme | null = context.getSnapshot().theme ?? null
  let disposed = false
  const snippetTokens = context.getFeature(EDITOR_SNIPPET_TOKENS_FEATURE)
  const codeTokenizer = snippetTokens ? createTooltipCodeTokenizer(snippetTokens) : null

  const tooltip: TooltipController = createTooltipController({
    document: ownerDocument,
    themeSource: element,
    reentryElement: element,
    markdownCodeBackground: options.markdownCodeBackground,
    classNamespace: options.classNamespace,
    codeTokenizer,
    onDidHide: () => cancelOperation(),
    onRequestEditorFocus: () => context.focusEditor(),
  })

  const cancelOperation = (): void => {
    const current = operation
    if (!current) return
    operation = null
    clearTimers(current)
    current.abort.abort()
  }

  const hide = (): void => {
    cancelOperation()
    tooltip.hide()
  }

  const warmCodeBlock = (block: TooltipCodeBlock): void => {
    void codeTokenizer?.tokenize(block.text, block.languageId)
  }

  const isCurrent = (candidate: HoverOperation): boolean => operation === candidate

  const render = (current: HoverOperation): void => {
    if (!isCurrent(current)) return

    const parts = orderedParts(current)
    const blocks = parts.flatMap((part) => (part.markdown ? tooltipCodeBlocks(part.markdown) : []))
    // An answer usually lands inside the dwell, so its tokens are asked for before the reveal.
    if (!current.revealed) return blocks.forEach(warmCodeBlock)

    const pending = current.pendingAsync > 0
    if (parts.length === 0 && pending && !current.loading) return
    if (parts.length === 0 && !pending) return hide()

    const tokens = codeTokenizer?.prepare(blocks)
    if (tokens) return void tokens.then(() => render(current))

    const range = unionOffsetRange(parts.map((part) => part.range)) ?? current.anchor.range
    const rect = context.getRangeClientRect(range.start, range.end)
    if (!rect) return hide()

    tooltip.show({
      anchor: rect,
      hoverText: null,
      parts,
      theme,
      loading: current.loading && pending,
      focus: current.focusOnShow && !current.shown,
      preferredPlacement: 'top',
    })
    current.shown = true
  }

  const runAsync = (current: HoverOperation, request: HoverRequest): void => {
    for (const participant of current.participants) {
      if (!participant.computeAsync) continue
      current.pendingAsync += 1
      const emit = (parts: readonly HoverPart[]): void => {
        if (!isCurrent(current)) return
        resultFor(current, participant).async = parts
        render(current)
      }
      participant
        .computeAsync(request, emit)
        .catch(() => undefined)
        .finally(() => {
          if (!isCurrent(current)) return
          current.pendingAsync -= 1
          if (current.pendingAsync === 0 && current.loadingTimer) clearTimeout(current.loadingTimer)
          render(current)
        })
    }
  }

  const runSync = (current: HoverOperation, request: HoverRequest): void => {
    for (const participant of current.participants) {
      if (!participant.computeSync) continue
      resultFor(current, participant).sync = participant.computeSync(request)
    }
  }

  const reveal = (current: HoverOperation, request: HoverRequest): void => {
    if (!isCurrent(current)) return
    runSync(current, request)
    current.revealed = true
    render(current)
  }

  const revealLoading = (current: HoverOperation): void => {
    if (!isCurrent(current) || current.pendingAsync === 0) return
    current.revealed = true
    current.loading = true
    current.loadingTimer = null
    render(current)
  }

  const start = (anchor: HoverAnchor, focusOnShow: boolean): boolean => {
    const snapshot = context.getSnapshot()
    const participants = context.getProviders(EDITOR_HOVER_PARTICIPANT, snapshot.languageId)
    if (participants.length === 0) return false

    hide()
    nextOperationId += 1
    const current: HoverOperation = {
      id: nextOperationId,
      anchor,
      snapshot,
      participants,
      results: new Map(),
      abort: new AbortController(),
      focusOnShow,
      pendingAsync: 0,
      revealed: false,
      loading: false,
      shown: false,
      dispatchTimer: null,
      revealTimer: null,
      loadingTimer: null,
    }
    operation = current
    const request: HoverRequest = { anchor, snapshot, signal: current.abort.signal }
    // @justification Delays the loading row until the participants are observably slow; every
    // target change cancels it.
    current.loadingTimer = setTimeout(() => revealLoading(current), HOVER_LOADING_DELAY_MS)
    if (focusOnShow) {
      runAsync(current, request)
      reveal(current, request)
      return true
    }

    // @justification Starts server work midway through the pointer dwell so transient targets are
    // skipped while network time overlaps the rest of the dwell.
    current.dispatchTimer = setTimeout(() => {
      current.dispatchTimer = null
      runAsync(current, request)
    }, HOVER_ASYNC_DISPATCH_DELAY_MS)
    // @justification Enforces the hover dwell before paint; the pointer leaving the target clears it.
    current.revealTimer = setTimeout(() => {
      current.revealTimer = null
      reveal(current, request)
    }, HOVER_REQUEST_DEBOUNCE_MS)
    return true
  }

  const scheduleAt = (offset: number, point: HoverAnchor['point']): void => {
    tooltip.cancelHide()
    const snapshot = context.getSnapshot()
    const range = hoverTargetRangeInSource(snapshot.textSnapshot, offset)
    const current = operation
    if (
      current &&
      current.snapshot.textVersion === snapshot.textVersion &&
      sameOffsetRange(current.anchor.range, range)
    ) {
      return
    }

    start({ offset, range, source: 'pointer', point }, false)
  }

  const handlePointerMove = (event: PointerEvent): void => {
    if (event.buttons !== 0) return hide()
    if (tooltip.shouldKeepForPointer(event.clientX, event.clientY)) return tooltip.cancelHide()
    if (!context.hasDocument()) return hide()

    const offset = context.textOffsetFromPoint(event.clientX, event.clientY)
    if (offset === null) {
      cancelOperation()
      return tooltip.scheduleHide()
    }

    scheduleAt(offset, { clientX: event.clientX, clientY: event.clientY })
  }

  const handlePointerLeave = (event: PointerEvent): void => {
    if (tooltip.containsTarget(event.relatedTarget)) return tooltip.cancelHide()
    // A hover that has not painted yet has nothing to keep: the pointer is gone.
    if (operation && !operation.shown) cancelOperation()
    tooltip.scheduleHide()
  }

  const handleDocumentPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    if (tooltip.containsTarget(event.target)) return
    hide()
  }

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (isModifierKey(event.key)) return
    hide()
  }

  element.addEventListener('pointermove', handlePointerMove)
  element.addEventListener('pointerleave', handlePointerLeave)
  element.addEventListener('keydown', handleKeyDown)
  ownerDocument.addEventListener('pointerdown', handleDocumentPointerDown, { capture: true })

  return {
    update: (snapshot, kind) => {
      const nextTheme = snapshot.theme ?? null
      if (nextTheme !== theme) codeTokenizer?.clear()
      theme = nextTheme
      if (shouldHideOnUpdate(kind)) hide()
    },
    showAtOffset: (offset, showOptions = {}) => {
      if (disposed || !context.hasDocument()) return false
      const range = hoverTargetRangeInSource(context.getSnapshot().textSnapshot, offset)
      return start({ offset, range, source: 'keyboard' }, showOptions.focus ?? false)
    },
    hide,
    containsTarget: (target) => tooltip.containsTarget(target),
    dispose: () => {
      if (disposed) return
      disposed = true
      element.removeEventListener('pointermove', handlePointerMove)
      element.removeEventListener('pointerleave', handlePointerLeave)
      element.removeEventListener('keydown', handleKeyDown)
      ownerDocument.removeEventListener('pointerdown', handleDocumentPointerDown, { capture: true })
      hide()
      tooltip.dispose()
    },
  }
}

function resultFor(
  operation: HoverOperation,
  participant: EditorHoverParticipant,
): ParticipantResult {
  const existing = operation.results.get(participant)
  if (existing) return existing
  const created: ParticipantResult = { sync: [], async: [] }
  operation.results.set(participant, created)
  return created
}

/** Every part on screen, lowest ordinal first; ties keep participant and emission order. */
function orderedParts(operation: HoverOperation): readonly HoverPart[] {
  const parts: HoverPart[] = []
  for (const participant of operation.participants) {
    const result = operation.results.get(participant)
    if (!result) continue
    parts.push(...result.sync, ...result.async)
  }
  return parts.toSorted((left, right) => left.ordinal - right.ordinal)
}

function clearTimers(operation: HoverOperation): void {
  if (operation.dispatchTimer) clearTimeout(operation.dispatchTimer)
  if (operation.revealTimer) clearTimeout(operation.revealTimer)
  if (operation.loadingTimer) clearTimeout(operation.loadingTimer)
  operation.dispatchTimer = null
  operation.revealTimer = null
  operation.loadingTimer = null
}

/**
 * A scroll or relayout moves the text out from under the hover, and an edit may have changed what
 * it says. Both belong to the old frame, so the hover goes with them.
 */
function shouldHideOnUpdate(kind: EditorViewContributionUpdateKind): boolean {
  if (anchoredSurfaceFollowsUpdate(kind)) return true
  return kind === 'content' || kind === 'document' || kind === 'clear'
}

function isModifierKey(key: string): boolean {
  return key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta'
}
