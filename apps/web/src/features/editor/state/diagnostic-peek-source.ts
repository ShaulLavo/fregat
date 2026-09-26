import type {
  EditorPlugin,
  EditorTextAnchor,
  EditorTrackedPoint,
  EditorTrackedRanges,
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import type { LanguageServerDefinitionTarget } from '@singapore-editor/lsp-plugin/websocket'
import type {
  LanguageServerDiagnosticMarkerClaim,
  LanguageServerDiagnosticMarkerEvent,
} from '@singapore-editor/lsp-plugin'

import {
  copyDiagnosticPeekClientRect,
  type DiagnosticPeekClientRect,
} from '@/features/editor/utils/diagnostic-peek-placement'
import {
  diagnosticMessageText,
  diagnosticSeverityLabel,
  diagnosticTargetForUri,
} from '@/lib/diagnostic'

type DiagnosticPeekGeometry =
  | {
      readonly kind: 'visible'
      readonly range: { readonly start: number; readonly end: number }
      readonly anchorRect: DiagnosticPeekClientRect
      readonly clipRect: DiagnosticPeekClientRect
    }
  | {
      readonly kind: 'hidden'
      readonly range: { readonly start: number; readonly end: number }
    }

type DiagnosticPeekRelatedInformation = {
  readonly label: string
  readonly line: number
  readonly column: number
  readonly target: LanguageServerDefinitionTarget
}

export type DiagnosticPeekModel = {
  readonly code: string | null
  readonly direction: 'next' | 'previous'
  readonly documentUri: string
  readonly geometry: DiagnosticPeekGeometry
  readonly message: string
  readonly relatedInformation: readonly DiagnosticPeekRelatedInformation[]
  readonly severity: string
  /** The language server's number, for Fix with AI; `severity` is its label. */
  readonly severityLevel: number | undefined
  readonly source: string | null
}

export type DiagnosticPeekSnapshot = DiagnosticPeekModel | null

type ActiveTracker =
  | { readonly kind: 'point'; readonly tracker: EditorTrackedPoint }
  | { readonly kind: 'range'; readonly tracker: EditorTrackedRanges }

export function createDiagnosticPeekSource(documentUri: string) {
  let context: EditorViewContributionContext | null = null
  let documentId: string | null = null
  let generation = 0
  let model: Omit<DiagnosticPeekModel, 'geometry'> | null = null
  let snapshot: DiagnosticPeekSnapshot = null
  let tracker: ActiveTracker | null = null
  const listeners = new Set<() => void>()

  const publish = (next: DiagnosticPeekSnapshot) => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  const close = () => {
    if (!model && !tracker && !snapshot) return
    generation += 1
    model = null
    tracker = null
    publish(null)
  }

  const updateGeometry = () => {
    if (!context || !model || !tracker) return
    const range = resolveTracker(tracker)
    if (!range) return
    if ('kind' in range) return close()

    const anchorRect = context.getRangeClientRect(range.start, range.end)
    if (!anchorRect) return publish({ ...model, geometry: { kind: 'hidden', range } })

    publish({
      ...model,
      geometry: {
        anchorRect: copyDiagnosticPeekClientRect(anchorRect),
        clipRect: copyDiagnosticPeekClientRect(context.scrollElement.getBoundingClientRect()),
        kind: 'visible',
        range,
      },
    })
  }

  const claim = (
    event: LanguageServerDiagnosticMarkerEvent,
  ): LanguageServerDiagnosticMarkerClaim => {
    if (!context || event.documentUri !== documentUri) return { kind: 'ignored' }
    const view = context.getSnapshot()
    if (view.textVersion !== event.textVersion) return { kind: 'ignored' }

    const nextTracker = createTracker(context, event.anchor)
    if (!nextTracker) return { kind: 'ignored' }

    close()
    const claimGeneration = generation
    documentId = view.documentId
    tracker = nextTracker
    model = normalizeEvent(event)
    updateGeometry()
    let disposed = false
    return {
      kind: 'claimed',
      dispose: () => {
        if (disposed) return
        disposed = true
        if (claimGeneration !== generation) return
        close()
      },
    }
  }

  const plugin: EditorPlugin = {
    name: 'platform-diagnostic-peek',
    activate: (pluginContext) =>
      pluginContext.registerViewContribution({
        createContribution: (viewContext) => {
          context = viewContext
          documentId = viewContext.getSnapshot().documentId
          return {
            update: (view, kind) => {
              if (terminalViewUpdate(kind, view, documentId)) return close()
              updateGeometry()
            },
            dispose: () => {
              context = null
              documentId = null
              close()
            },
          }
        },
      }),
  }

  return {
    claim,
    close,
    getSnapshot: () => snapshot,
    plugin,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function terminalViewUpdate(
  kind: EditorViewContributionUpdateKind,
  view: EditorViewSnapshot,
  documentId: string | null,
): boolean {
  if (kind === 'clear') return true
  if (kind !== 'document') return false
  return view.documentId !== documentId
}

function createTracker(
  context: EditorViewContributionContext,
  anchor: EditorTextAnchor,
): ActiveTracker | null {
  if (anchor.kind === 'point') {
    if (!context.trackPoint) return null
    return { kind: 'point', tracker: context.trackPoint(anchor) }
  }

  if (!context.trackRanges) return null
  return {
    kind: 'range',
    tracker: context.trackRanges([{ start: anchor.start, end: anchor.end }], {
      startBias: anchor.startBias,
      endBias: anchor.endBias,
    }),
  }
}

function resolveTracker(
  tracker: ActiveTracker,
): { readonly start: number; readonly end: number } | { readonly kind: 'deleted' } | null {
  if (tracker.kind === 'range') return tracker.tracker.resolve()[0] ?? { kind: 'deleted' }
  const point = tracker.tracker.resolve()
  if (!point || point.kind === 'deleted') return point
  return { start: point.offset, end: point.offset }
}

function normalizeEvent(
  event: LanguageServerDiagnosticMarkerEvent,
): Omit<DiagnosticPeekModel, 'geometry'> {
  return {
    code: diagnosticCode(event.diagnostic.code),
    direction: event.direction,
    documentUri: event.documentUri,
    message: diagnosticMessageText(event.diagnostic.message),
    relatedInformation: (event.diagnostic.relatedInformation ?? []).flatMap((information) => {
      const target = diagnosticTargetForUri(information.location.uri, information.location.range)
      if (!target) return []
      return [
        {
          column: information.location.range.start.character + 1,
          label: information.message,
          line: information.location.range.start.line + 1,
          target,
        },
      ]
    }),
    severity: diagnosticSeverityLabel(event.diagnostic.severity),
    severityLevel: event.diagnostic.severity,
    source: event.diagnostic.source ?? null,
  }
}

function diagnosticCode(code: number | string | undefined): string | null {
  if (code === undefined) return null
  return String(code)
}
