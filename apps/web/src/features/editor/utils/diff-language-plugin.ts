import type {
  EditorPlugin,
  EditorTheme,
  EditorViewContributionContext,
} from '@singapore-editor/core'
import {
  HOVER_REQUEST_DEBOUNCE_MS,
  createTooltipController,
} from '@singapore-editor/lsp-plugin/tooltip'

import type { DiffQueryTarget } from '@/features/editor/utils/diff-language-query'
import type { DiffFilePosition, DiffFileSide } from '@/features/editor/utils/diff-position-map'
import { log } from '@/lib/client-logging'

/** What came of following a definition from a diff. */
export type DiffDefinitionOutcome =
  /** The host opened another file at the target. */
  | { readonly kind: 'opened' }
  /** The target is a line of one of the two texts this diff is already drawing. */
  | { readonly kind: 'in-diff'; readonly side: DiffFileSide; readonly position: DiffFilePosition }
  /** The server had no definition, or it named something no file can be opened for. */
  | { readonly kind: 'none' }

export type DiffLanguageOptions = {
  /** Decides whether this point may be asked about, and where it is. */
  readonly resolve: (offset: number) => DiffQueryTarget
  /** Issues the hover request. Resolves to markup, or null when there is nothing to show. */
  readonly hover: (target: DiffAskTarget) => Promise<string | null>
  /** Issues the definition request and does whatever opening it requires. */
  readonly definition: (target: DiffAskTarget) => Promise<DiffDefinitionOutcome>
  /** Where a position in one of the two texts sits in this pane's buffer, if it is drawn at all. */
  readonly bufferOffsetAt: (side: DiffFileSide, position: DiffFilePosition) => number | null
  readonly theme: () => EditorTheme | null
}

export type DiffAskTarget = Extract<DiffQueryTarget, { kind: 'ask' }>

/** Only what the cursor needs, so a coalesced move does not retain the event. */
type PointerMove = {
  readonly clientX: number
  readonly clientY: number
  readonly navigationModifier: boolean
}

/**
 * Hover and go-to-definition over a diff, answered by documents the diff itself opened.
 *
 * Owns its tooltip and its pointer handling, and owns no document. Everything that could be WRONG —
 * whether this point is a real line of a real text, and whether that text is still what the server
 * holds — lives behind `resolve`, so there is one place to get it right rather than one per
 * feature. That is the shape both prior arts missed: VS Code ships an enabled, permanently
 * no-opping "Go to definition" on `git:` documents, and Zed guards deleted-hunk positions in two
 * files and not in hover.
 *
 * The cursor follows the same answer, so a row that cannot be asked about does not look like one
 * that can.
 */
export function createDiffLanguagePlugin(options: DiffLanguageOptions): EditorPlugin {
  return {
    name: 'platform-diff-language',
    activate: (context) =>
      context.registerViewContribution({
        createContribution: (viewContext) => createContribution(viewContext, options),
      }),
  }
}

function createContribution(context: EditorViewContributionContext, options: DiffLanguageOptions) {
  const element = context.scrollElement
  const tooltip = createTooltipController({
    document: element.ownerDocument,
    reentryElement: element,
    // The scroll element carries the `--editor-*` block, so the tooltip inherits whichever theme
    // the diff is currently painted in.
    themeSource: element,
  })
  let timer: ReturnType<typeof setTimeout> | null = null
  let generation = 0
  let pendingMove: PointerMove | null = null
  let moveFrame: number | null = null

  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    // Bumped so a reply already in flight cannot land after the pointer has moved on.
    generation += 1
  }

  const showHover = (target: DiffAskTarget, offset: number): void => {
    const current = generation
    timer = setTimeout(() => {
      timer = null
      void options
        .hover(target)
        .then((markup) => {
          if (current !== generation) return
          if (!markup) return tooltip.scheduleHide()

          const anchor = context.getRangeClientRect(offset, offset)
          if (!anchor) return tooltip.scheduleHide()

          tooltip.show({ anchor, diagnostics: [], hoverText: markup, theme: options.theme() })
        })
        .catch((error: unknown) => {
          // Logged, not swallowed: a request that throws — a server that does not hold the
          // document, a closed socket — looked exactly like a position with nothing to say, and
          // left nothing anywhere to tell them apart.
          log.warn({ action: 'diff.hover', area: 'editor', error, outcome: 'threw' })
          tooltip.hide()
        })
    }, HOVER_REQUEST_DEBOUNCE_MS)
  }

  const cancelPendingMove = (): void => {
    if (moveFrame !== null) cancelAnimationFrame(moveFrame)
    moveFrame = null
    pendingMove = null
  }

  const applyMove = (move: PointerMove): void => {
    const offset = context.textOffsetFromPoint(move.clientX, move.clientY)
    if (offset === null) return tooltip.scheduleHide()

    const target = options.resolve(offset)
    element.style.cursor = cursorFor(target, move.navigationModifier)
    if (target.kind !== 'ask') return tooltip.scheduleHide()

    showHover(target, offset)
  }

  /** One hit test per frame: mousemove outruns the frame rate, and hit-testing forces a layout. */
  const handleMouseMove = (event: MouseEvent): void => {
    cancel()
    pendingMove = {
      clientX: event.clientX,
      clientY: event.clientY,
      navigationModifier: isNavigationModifier(event),
    }
    if (moveFrame !== null) return

    moveFrame = requestAnimationFrame(() => {
      moveFrame = null
      const move = pendingMove
      pendingMove = null
      if (move) applyMove(move)
    })
  }

  const handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) return
    if (!isNavigationModifier(event)) return

    const offset = context.textOffsetFromPoint(event.clientX, event.clientY)
    if (offset === null) return

    const target = options.resolve(offset)
    if (target.kind !== 'ask') return

    // Taken before the editor can turn it into a caret placement: a modified click is a navigation,
    // and leaving the selection behind on a read-only pane is the tell that nothing happened.
    event.preventDefault()
    event.stopImmediatePropagation()
    cancel()
    // The frame queued by the mousemove that preceded this click would otherwise still run, and
    // put the tooltip back over a definition the click has already navigated to.
    cancelPendingMove()
    tooltip.hide()
    void followDefinition(target)
  }

  const followDefinition = async (target: DiffAskTarget): Promise<void> => {
    const outcome = await options.definition(target).catch((error: unknown) => {
      log.warn({ action: 'diff.definition', area: 'editor', error, outcome: 'threw' })
      return { kind: 'none' } as const
    })
    if (outcome.kind !== 'in-diff') return

    // A definition that lands in one of the texts this pane is already drawing is shown here rather
    // than by opening a file: the old side has no file to open, and the new side is on screen.
    const offset = options.bufferOffsetAt(outcome.side, outcome.position)
    if (offset === null) return

    context.focusEditor()
    context.setSelection(offset, offset, 'diff-definition', {
      revealBlock: 'center',
      revealOffset: offset,
    })
  }

  const handleLeave = (): void => {
    cancel()
    cancelPendingMove()
    element.style.cursor = ''
    tooltip.scheduleHide()
  }

  element.addEventListener('mousemove', handleMouseMove)
  element.addEventListener('mousedown', handleMouseDown, { capture: true })
  element.addEventListener('mouseleave', handleLeave)

  return {
    update: () => undefined,
    dispose: () => {
      cancel()
      cancelPendingMove()
      element.removeEventListener('mousemove', handleMouseMove)
      element.removeEventListener('mousedown', handleMouseDown, { capture: true })
      element.removeEventListener('mouseleave', handleLeave)
      element.style.cursor = ''
      tooltip.dispose()
    },
  }
}

/**
 * What the pointer says about this row.
 *
 * A row nothing can be asked about gets an arrow, so it does not read as text with answers behind
 * it. A row that can be, held with the navigation modifier, gets the pointer every editor uses for
 * "this is a link".
 */
function cursorFor(target: DiffQueryTarget, navigationModifier: boolean): string {
  if (target.kind !== 'ask') return 'default'

  return navigationModifier ? 'pointer' : ''
}

/** Cmd on a Mac, Ctrl everywhere else — the same split the editor's own navigation uses. */
function isNavigationModifier(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey
}
