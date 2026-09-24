import { hasCommandModifier as isNavigationModifier } from '@workspace/utils/keyboard'
import type { EditorTheme } from '@singapore-editor/core/rendering'
import type { EditorPlugin, EditorViewContributionContext } from '@singapore-editor/core/extensions'
import {
  EDITOR_HOVER_PARTICIPANT,
  type HoverRequest,
} from '@singapore-editor/plugin-ui/hover-participant'

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
 * Owns the cursor and the modified click, answers the shared hover, and owns no document. Everything that could be WRONG —
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
  const hover = context.registerProvider(
    EDITOR_HOVER_PARTICIPANT,
    { language: '*' },
    { computeAsync: (request, emit) => answerHover(options, request, emit) },
  )
  let pendingMove: PointerMove | null = null
  let moveFrame: number | null = null

  const cancelPendingMove = (): void => {
    if (moveFrame !== null) cancelAnimationFrame(moveFrame)
    moveFrame = null
    pendingMove = null
  }

  const applyMove = (move: PointerMove): void => {
    const offset = context.textOffsetFromPoint(move.clientX, move.clientY)
    if (offset === null) {
      element.style.cursor = ''
      return
    }

    const target = options.resolve(offset)
    element.style.cursor = cursorFor(target, move.navigationModifier)
  }

  /** One hit test per frame: mousemove outruns the frame rate, and hit-testing forces a layout. */
  const handleMouseMove = (event: MouseEvent): void => {
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

  // A modified click is a navigation, so the editor must not also turn it into a caret placement:
  // leaving the selection behind on a read-only pane is the tell that nothing happened.
  const claimNavigationPress = (event: MouseEvent): boolean => {
    if (event.button !== 0) return false
    if (!isNavigationModifier(event)) return false

    const offset = context.textOffsetFromPoint(event.clientX, event.clientY)
    if (offset === null) return false

    const target = options.resolve(offset)
    if (target.kind !== 'ask') return false

    // The frame queued by the mousemove that preceded this click would otherwise still run, and
    // repaint the cursor for a position the click has already navigated away from.
    cancelPendingMove()
    void followDefinition(target)
    return true
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
    cancelPendingMove()
    element.style.cursor = ''
  }

  element.addEventListener('mousemove', handleMouseMove)
  const pressParticipant = context.registerPressParticipant(claimNavigationPress)
  element.addEventListener('mouseleave', handleLeave)

  return {
    update: () => undefined,
    dispose: () => {
      hover.dispose()
      cancelPendingMove()
      element.removeEventListener('mousemove', handleMouseMove)
      pressParticipant.dispose()
      element.removeEventListener('mouseleave', handleLeave)
      element.style.cursor = ''
    },
  }
}

/** The diff's contribution to the shared hover: what the server holding this side says. */
async function answerHover(
  options: DiffLanguageOptions,
  request: HoverRequest,
  emit: (
    parts: readonly { ordinal: number; range: HoverRequest['anchor']['range']; markdown: string }[],
  ) => void,
): Promise<void> {
  const target = options.resolve(request.anchor.offset)
  if (target.kind !== 'ask') return

  try {
    const markup = await options.hover(target)
    if (!markup || request.signal.aborted) return
    emit([{ ordinal: 1, range: request.anchor.range, markdown: markup }])
  } catch (error) {
    // Logged, not swallowed: a request that throws — a server that does not hold the document, a
    // closed socket — looked exactly like a position with nothing to say, and left nothing anywhere
    // to tell them apart.
    log.warn({ action: 'diff.hover', area: 'editor', error, outcome: 'threw' })
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
