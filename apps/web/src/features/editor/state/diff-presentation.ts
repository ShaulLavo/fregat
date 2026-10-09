import type {
  DiffPlugin,
  DiffRenderRow,
  DiffGutterSide,
  DiffSyntaxBackend,
} from '@singapore-editor/diff'
import type { HighlightingThemeSource } from '@singapore-editor/highlighting'
import { joinRenderLines } from '@singapore-editor/diff'
import type { EditorPlugin, EditorViewContributionContext } from '@singapore-editor/core/extensions'
import type { Editor } from '@singapore-editor/core/editor'
import type { EditorToken } from '@singapore-editor/core/syntax'
import {
  diffInputClaim,
  matchingDiffView,
  pendingDiffRestore,
  type DiffPanePresentation,
  type DiffPanePublication,
  type DiffPanePublicationSink,
} from '@/features/editor/state/tab-presentation'
import {
  diffAttachmentRevision,
  diffAttachmentSubject,
  sameDiffAttachmentSubject,
  type DiffAttachment,
} from '@/lib/diff-attachment'
import { diffAttachmentLines } from '@/features/editor/utils/attachment-presentation'
import { captureDiffAnchors, resolveDiffAnchors } from '@/features/editor/utils/diff-source-anchors'

type SyntaxConfiguration = {
  readonly backend: DiffSyntaxBackend
  readonly theme: HighlightingThemeSource | null
  readonly enabled: boolean
}

export function createDiffPresentationBinding(
  presentation: DiffPanePresentation,
  side: DiffGutterSide = 'stacked',
  onPublication?: DiffPanePublicationSink,
) {
  let view: EditorViewContributionContext | null = null
  let restored = false
  let publication: DiffPanePublication | null = null
  let queued: { currentView: EditorViewContributionContext; entry: object } | null = null
  let installed: {
    editor: Editor
    attachment: DiffAttachment
    rows: readonly DiffRenderRow[]
    tokens: readonly EditorToken[]
    lines: ReturnType<typeof diffAttachmentLines>
    configuration: SyntaxConfiguration
    documentId: string | null
    textVersion: number
    projectionLength: number
  } | null = null

  function withdraw() {
    if (!publication) return
    const previous = publication
    publication = null
    onPublication?.({ kind: 'withdrawn', publication: previous })
  }

  function schedulePublication() {
    if (!onPublication || !view || !installed || !restored) return
    const currentView = view
    const entry = installed
    if (queued?.currentView === currentView && queued.entry === entry) return
    const pending = { currentView, entry }
    queued = pending
    // Contribution updates run inside paint delivery; inspect the committed view after it returns.
    queueMicrotask(() => {
      if (queued !== pending || view !== currentView || installed !== entry || !restored) return
      queued = null
      const snapshot = currentView.getSnapshot()
      if (
        snapshot.documentId === null ||
        snapshot.documentId !== entry.documentId ||
        snapshot.textVersion !== entry.textVersion ||
        snapshot.geometryCommitted !== true ||
        snapshot.viewport.clientWidth <= 0 ||
        snapshot.viewport.clientHeight <= 0 ||
        (entry.projectionLength > 0 && snapshot.visibleRows.length === 0)
      ) {
        withdraw()
        return
      }
      const next: DiffPanePublication = {
        attachment: entry.attachment,
        side,
        editor: entry.editor,
        documentId: snapshot.documentId,
        textVersion: snapshot.textVersion,
        geometryCommitted: true,
        viewportWidth: snapshot.viewport.clientWidth,
        viewportHeight: snapshot.viewport.clientHeight,
        visibleRowCount: snapshot.visibleRows.length,
        projectionLength: entry.projectionLength,
      }
      if (publication && samePublication(publication, next)) return
      withdraw()
      publication = next
      onPublication({ kind: 'presented', publication: next })
    })
  }

  function installedAnchors(
    entry: NonNullable<typeof installed>,
    snapshot: ReturnType<EditorViewContributionContext['getSnapshot']>,
  ) {
    const anchors = captureDiffAnchors(
      entry.lines,
      entry.rows,
      side,
      snapshot,
      !entry.editor.isWordWrapEnabled(),
    )
    if (anchors.viewport || snapshot.viewport.clientHeight > 0) return anchors
    const saved = matchingDiffView(presentation, entry.attachment)
    return saved ? { ...anchors, viewport: saved.anchors.viewport } : anchors
  }

  function capture() {
    schedulePublication()
    if (!view || !restored || !installed) return
    presentation.views.set(diffAttachmentSubject(installed.attachment).key, {
      ...diffInputClaim(installed.attachment),
      anchors: installedAnchors(installed, view.getSnapshot()),
    })
  }

  function detach() {
    capture()
    restored = false
    installed = null
    queued = null
    withdraw()
  }

  function dispose() {
    detach()
    view = null
  }

  function createContribution(current: EditorViewContributionContext) {
    view = current
    return { update: capture, dispose }
  }

  const plugin: EditorPlugin = {
    name: 'platform-diff-presentation',
    activate: (context) => context.registerViewContribution({ createContribution }),
  }

  function publish(
    editor: Editor,
    attachment: DiffAttachment,
    rows: readonly DiffRenderRow[],
    tokens: readonly EditorToken[],
    configuration: SyntaxConfiguration,
  ): boolean {
    if (!view) return false
    const previous = installed
    const restoring = pendingDiffRestore(presentation, attachment)
    if (
      !presentation.pendingRestore &&
      previous?.editor === editor &&
      sameAttachment(previous.attachment, attachment) &&
      previous.rows === rows &&
      previous.tokens === tokens &&
      sameConfiguration(previous.configuration, configuration)
    )
      return false
    presentation.pendingRestore = null
    const subject = diffAttachmentSubject(attachment)
    const sameSubject =
      previous?.editor === editor &&
      sameDiffAttachmentSubject(diffAttachmentSubject(previous.attachment), subject)
    const snapshot = view.getSnapshot()
    const anchors = sameSubject && previous ? installedAnchors(previous, snapshot) : null
    capture()
    restored = false
    const saved = matchingDiffView(presentation, attachment)
    const selected = restoring?.anchors ?? anchors ?? saved?.anchors ?? null
    const lines =
      previous && sameAttachment(previous.attachment, attachment)
        ? previous.lines
        : diffAttachmentLines(attachment)
    const sameInput =
      !previous ||
      Boolean(restoring) ||
      diffAttachmentRevision(previous.attachment) === diffAttachmentRevision(attachment)
    const mapped = selected
      ? resolveDiffAnchors(
          selected,
          sameSubject && !restoring ? (previous?.lines ?? null) : null,
          lines,
          rows,
          snapshot.metrics.rowHeight,
          sameInput,
        )
      : null
    const text = joinRenderLines(rows)
    if (sameSubject) {
      editor.syncText(text, { documentMode: 'static', languageId: null, tokens })
    } else {
      editor.openDocument({
        documentId: `projection:diff:${subject.key}:${side}`,
        text,
        documentMode: 'static',
        languageId: null,
        tokens,
        scrollPosition: { left: 0, top: 0 },
      })
    }
    const installedSnapshot = view.getSnapshot()
    installed = {
      editor,
      attachment,
      rows,
      tokens,
      lines,
      configuration,
      documentId: `projection:diff:${subject.key}:${side}`,
      textVersion: installedSnapshot.textVersion,
      projectionLength: text.length,
    }
    if (mapped) {
      view.setSelections(mapped.selections, 'editor.restoreDiffAnchor')
      if (snapshot.metrics.rowHeight > 0) editor.setScrollPosition(mapped.scroll)
    } else {
      view.setSelections([{ anchor: 0, head: 0 }], 'editor.startDiffSubject')
      editor.setScrollPosition({ left: 0, top: 0 })
    }
    restored = true
    capture()
    return true
  }

  function publishTokens(
    editor: Editor,
    attachment: DiffAttachment,
    rows: readonly DiffRenderRow[],
    tokens: readonly EditorToken[],
    configuration: SyntaxConfiguration,
  ) {
    if (
      installed?.editor !== editor ||
      !sameAttachment(installed.attachment, attachment) ||
      installed.rows !== rows ||
      !sameConfiguration(installed.configuration, configuration) ||
      !restored
    )
      return
    editor.setTokens(tokens)
    installed = { ...installed, tokens }
    schedulePublication()
  }

  return { plugin, detach, publish, publishTokens, isRestoringProjection: () => !restored }
}

function sameAttachment(left: DiffAttachment, right: DiffAttachment): boolean {
  if (left === right) return true
  if (left.file !== right.file || left.kind !== right.kind) return false
  switch (left.kind) {
    case 'settings':
      return right.kind === 'settings' && left.read === right.read
    case 'filesystem':
      return (
        right.kind === 'filesystem' && left.read === right.read && left.meaning === right.meaning
      )
    case 'operation':
      return right.kind === 'operation' && left.read === right.read
    case 'snapshot':
      return right.kind === 'snapshot' && left.read === right.read && left.child === right.child
    case 'saved':
      return right.kind === 'saved' && left.read === right.read
    case 'history':
      return right.kind === 'history' && left.read === right.read && left.meaning === right.meaning
    case 'projection-control':
      return (
        right.kind === 'projection-control' &&
        left.subject === right.subject &&
        left.revision === right.revision
      )
  }
}

function samePublication(left: DiffPanePublication, right: DiffPanePublication): boolean {
  return (
    sameAttachment(left.attachment, right.attachment) &&
    left.side === right.side &&
    left.editor === right.editor &&
    left.documentId === right.documentId &&
    left.textVersion === right.textVersion &&
    left.viewportWidth === right.viewportWidth &&
    left.viewportHeight === right.viewportHeight &&
    left.visibleRowCount === right.visibleRowCount &&
    left.projectionLength === right.projectionLength
  )
}

function sameConfiguration(left: SyntaxConfiguration, right: SyntaxConfiguration): boolean {
  return (
    left.backend.kind === right.backend.kind &&
    left.backend.provider === right.backend.provider &&
    left.theme === right.theme &&
    left.enabled === right.enabled
  )
}

export function bindDiffPlugin(presentation: DiffPanePresentation, plugin: DiffPlugin) {
  presentation.plugin = plugin
  return () => {
    if (presentation.plugin === plugin) presentation.plugin = null
  }
}
