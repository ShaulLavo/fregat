import {
  tokenPaintMismatch,
  type TokenPaintReference,
} from '../../../../scripts/agent/scenarios/editor-tab-hover-highlights-probe'
import type { RetentionAcceptanceReloadResult } from '../../retention-acceptance.vitest.config'

type ReloadFrame = NonNullable<RetentionAcceptanceReloadResult['frames']>[number]

export function retentionAcceptanceReloadFrameOutcome(input: {
  readonly frame: ReloadFrame
  readonly settledReference: TokenPaintReference
  readonly expectedPath: string
  readonly syntax: 'plain' | 'colored'
  readonly currentReady: boolean
}) {
  const { frame, settledReference, expectedPath, syntax, currentReady } = input
  if (!frame.editor || frame.rows.length === 0) {
    if (currentReady)
      return { kind: 'mismatch', why: 'current editor or rows disappeared' } as const
    return { kind: 'before-entry' } as const
  }
  if (frame.observation?.kind !== 'mounted' || frame.observation.views.length !== 1)
    return { kind: 'mismatch', why: 'current mounted subject' } as const
  const visible = frame.observation.views[0]
  if (!visible || !('frame' in visible) || !visible.frame)
    return { kind: 'mismatch', why: 'current source observation' } as const
  if (visible.path !== expectedPath || visible.headerPath !== expectedPath)
    return { kind: 'mismatch', why: 'current header and body subject' } as const
  if (
    !currentReady &&
    syntax === 'colored' &&
    visible.kind === 'unready' &&
    visible.currentIdentity &&
    visible.source !== undefined
  ) {
    if (visible.syntaxStatus !== 'loading' || visible.paintLayers !== null)
      return { kind: 'mismatch', why: 'pending structural status' } as const
    if (!['loading', 'painted'].includes(visible.initialHighlightStatus ?? ''))
      return { kind: 'mismatch', why: 'pending highlight outcome' } as const
    if (!frame.input.mounted || frame.input.readonly || frame.input.disabled)
      return { kind: 'mismatch', why: 'pending editor input' } as const
    if (
      visible.source !== settledReference.source ||
      JSON.stringify(visible.currentIdentity) !== JSON.stringify(visible.frame.identity)
    )
      return { kind: 'mismatch', why: 'pending canonical source identity' } as const
    const reference =
      visible.initialHighlightStatus === 'painted'
        ? settledReference
        : {
            identity: visible.currentIdentity,
            source: visible.source,
            runs: [],
            expected: 'plain' as const,
          }
    const mismatch = tokenPaintMismatch(visible.frame, reference)
    if (mismatch) return { kind: 'mismatch', why: mismatch } as const
    return { kind: 'pending' } as const
  }
  if (visible.kind !== 'observed')
    return { kind: 'mismatch', why: 'current outcome unavailable' } as const
  if (
    visible.syntaxStatus !== (syntax === 'plain' ? 'plain' : 'ready') ||
    visible.initialHighlightStatus !== (syntax === 'plain' ? 'plain' : 'painted')
  )
    return { kind: 'mismatch', why: 'current native terminal outcome' } as const
  if (!visible.metadata || visible.metadata.paintLayers === null)
    return { kind: 'mismatch', why: 'unsupported current capture' } as const
  if (
    visible.metadata.documentId !== settledReference.identity.document ||
    visible.reference.source !== settledReference.source ||
    visible.reference.expected !== syntax ||
    visible.mismatch !== null
  )
    return { kind: 'mismatch', why: 'current canonical reference' } as const
  const mismatch = tokenPaintMismatch(visible.frame, settledReference)
  if (mismatch) return { kind: 'mismatch', why: mismatch } as const
  if (!visible.publicCapture) {
    if (currentReady) return { kind: 'mismatch', why: 'unsupported current capture' } as const
    return { kind: 'pending', phase: 'capture-pending' } as const
  }
  const capture = visible.publicCapture
  if (
    capture.documentId !== settledReference.identity.document ||
    capture.bufferRevision !== settledReference.identity.revision ||
    !capture.bufferMatchesCanonical ||
    capture.textVersion !== visible.metadata.textVersion ||
    capture.paintBytes <= 0
  )
    return { kind: 'mismatch', why: 'current public capture source' } as const
  return { kind: 'current' } as const
}
