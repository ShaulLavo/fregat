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
import type { DiffPanePresentation } from '@/features/editor/state/tab-presentation'
import {
  diffAttachmentRevision,
  diffAttachmentReferences,
  diffAttachmentLines,
  diffAttachmentSubject,
  sameDiffAttachmentSubject,
  type DiffAttachment,
} from '@/features/editor/utils/diff-attachment'
import { captureDiffAnchors, resolveDiffAnchors } from '@/features/editor/utils/diff-source-anchors'

type SyntaxConfiguration = {
  readonly backend: DiffSyntaxBackend
  readonly theme: HighlightingThemeSource | null
  readonly enabled: boolean
}

export function createDiffPresentationBinding(
  presentation: DiffPanePresentation,
  side: DiffGutterSide = 'stacked',
) {
  let view: EditorViewContributionContext | null = null
  let restored = false
  let installed: {
    editor: Editor
    attachment: DiffAttachment
    rows: readonly DiffRenderRow[]
    tokens: readonly EditorToken[]
    lines: ReturnType<typeof diffAttachmentLines>
    configuration: SyntaxConfiguration
  } | null = null

  function capture() {
    if (!view || !restored) return
    const snapshot = view.getSnapshot()
    presentation.selections = snapshot.selections
    presentation.scroll = { left: snapshot.viewport.scrollLeft, top: snapshot.viewport.scrollTop }
    if (!installed) return
    const subject = diffAttachmentSubject(installed.attachment)
    presentation.views.set(subject.key, {
      buffer: subject.buffer ? new WeakRef(subject.buffer) : null,
      revision: diffAttachmentRevision(installed.attachment),
      references: diffAttachmentReferences(installed.attachment).map(
        (reference) => new WeakRef(reference),
      ),
      anchors: captureDiffAnchors(installed.lines, installed.rows, side, snapshot),
    })
  }

  function detach() {
    capture()
    restored = false
    installed = null
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

  function restore(editor: Editor) {
    if (restored || !view) return
    const length = editor.getState().length
    const selections = presentation.selections.map((selection) => ({
      anchor: Math.min(selection.anchorOffset, length),
      head: Math.min(selection.headOffset, length),
      affinity: selection.affinity,
    }))
    view.setSelections(
      selections.length > 0 ? selections : [{ anchor: 0, head: 0 }],
      'editor.restoreDiffSelection',
    )
    editor.setScrollPosition(presentation.scroll ?? { left: 0, top: 0 })
    restored = true
  }

  function publish(
    editor: Editor,
    attachment: DiffAttachment,
    rows: readonly DiffRenderRow[],
    tokens: readonly EditorToken[],
    configuration: SyntaxConfiguration,
  ) {
    if (!view) return
    const previous = installed
    if (
      previous?.editor === editor &&
      previous.attachment === attachment &&
      previous.rows === rows &&
      previous.tokens === tokens &&
      sameConfiguration(previous.configuration, configuration)
    )
      return
    const subject = diffAttachmentSubject(attachment)
    const sameSubject =
      previous?.editor === editor &&
      sameDiffAttachmentSubject(diffAttachmentSubject(previous.attachment), subject)
    const snapshot = view.getSnapshot()
    const anchors =
      sameSubject && previous
        ? captureDiffAnchors(previous.lines, previous.rows, side, snapshot)
        : null
    capture()
    restored = false
    const saved = presentation.views.get(subject.key)
    const references = diffAttachmentReferences(attachment)
    const admitted =
      saved &&
      saved.revision === diffAttachmentRevision(attachment) &&
      (saved.buffer?.deref() ?? null) === subject.buffer &&
      saved.references.length === references.length &&
      saved.references.every((reference, index) => reference.deref() === references[index])
    const selected = anchors ?? (admitted ? saved.anchors : null)
    const lines =
      previous?.attachment === attachment ? previous.lines : diffAttachmentLines(attachment)
    const sameInput =
      !previous ||
      diffAttachmentRevision(previous.attachment) === diffAttachmentRevision(attachment)
    const mapped = selected
      ? resolveDiffAnchors(
          selected,
          sameSubject ? (previous?.lines ?? null) : null,
          lines,
          rows,
          snapshot.metrics.rowHeight,
          sameInput,
        )
      : null
    installed = { editor, attachment, rows, tokens, lines, configuration }
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
    if (mapped) {
      view.setSelections(mapped.selections, 'editor.restoreDiffAnchor')
      editor.setScrollPosition(mapped.scroll)
    } else if (!previous && presentation.views.size === 0) {
      restore(editor)
    } else {
      view.setSelections([{ anchor: 0, head: 0 }], 'editor.startDiffSubject')
      editor.setScrollPosition({ left: 0, top: 0 })
    }
    restored = true
    capture()
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
      installed.attachment !== attachment ||
      installed.rows !== rows ||
      !sameConfiguration(installed.configuration, configuration) ||
      !restored
    )
      return
    editor.setTokens(tokens)
    installed = { ...installed, tokens }
  }

  return { plugin, detach, restore, publish, publishTokens }
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
