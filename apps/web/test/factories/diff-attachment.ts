import {
  createDiffPlugin,
  createDiffRegionStore,
  type DiffFile,
  type DiffGutterSide,
} from '@singapore-editor/diff'
import type { DiffAttachment } from '@/features/editor/utils/diff-attachment'
import { Editor } from '@singapore-editor/core/editor'
import type {
  EditorViewSnapshot,
  EditorViewContributionContext,
} from '@singapore-editor/core/extensions'
import { createDiffPresentationBinding } from '@/features/editor/state/diff-presentation'
import {
  createTabPresentation,
  type DiffPanePresentation,
} from '@/features/editor/state/tab-presentation'
import { onTestFinished } from 'vitest'

export function projectionControl(
  file: DiffFile,
  subject = file.path,
  revision = 'initial',
): DiffAttachment {
  return { kind: 'projection-control', subject, revision, file }
}

export function mountDiffProjectionControl(
  initial: DiffAttachment,
  side: DiffGutterSide = 'stacked',
  presentation: DiffPanePresentation = createTabPresentation().diffPanes[side],
) {
  const host = document.createElement('div')
  document.body.append(host)
  const regions = createDiffRegionStore()
  const plugin = createDiffPlugin({ mode: 'document', side, regions, syntaxHighlight: false })
  const binding = createDiffPresentationBinding(presentation, side)
  const configuration = {
    backend: { kind: 'tree-sitter' as const, provider: null },
    theme: null,
    enabled: false,
  }
  let current = initial
  let context: EditorViewContributionContext | null = null
  let delivered: EditorViewSnapshot | null = null
  const editor = new Editor(host, {
    documentMode: 'static',
    plugins: [
      plugin,
      binding.plugin,
      {
        name: 'diff-control-observer',
        activate: (owner) =>
          owner.registerViewContribution({
            createContribution(view) {
              context = view
              return {
                update(snapshot) {
                  delivered = snapshot
                },
                dispose() {
                  context = null
                  delivered = null
                },
              }
            },
          }),
      },
    ],
  })
  let applied: DiffAttachment | null = null
  const rows = plugin.onDidChangeRows(() => {
    if (applied === current)
      binding.publish(editor, current, plugin.getRows(), plugin.getTokens(), configuration)
  })
  function publish(attachment: DiffAttachment) {
    current = attachment
    plugin.setFile(attachment.file)
    applied = attachment
    binding.publish(editor, attachment, plugin.getRows(), plugin.getTokens(), configuration)
  }
  publish(initial)
  onTestFinished(() => {
    rows.dispose()
    binding.detach()
    editor.dispose()
    host.remove()
  })
  return {
    editor,
    plugin,
    regions,
    presentation,
    publish,
    binding,
    snapshot() {
      if (!context) throw new RangeError('Diff control view is missing')
      return context.getSnapshot()
    },
    delivered() {
      return delivered
    },
    offset(line: number, sourceSide: 'old' | 'new' = 'new') {
      const row = plugin
        .getRows()
        .findIndex(
          (entry) => (sourceSide === 'old' ? entry.oldLineNumber : entry.newLineNumber) === line,
        )
      if (row < 0) throw new RangeError('Diff control source line is hidden')
      return plugin
        .getRows()
        .slice(0, row)
        .reduce((offset, entry) => offset + entry.text.length + 1, 0)
    },
  }
}
