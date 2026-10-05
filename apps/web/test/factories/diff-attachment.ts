import {
  createDiffPlugin,
  createDiffRegionStore,
  type DiffFile,
  type DiffGutterSide,
  type DiffSyntaxSourceReader,
  type PreparedDiffSyntaxInput,
} from '@singapore-editor/diff'
import { highlightingService } from '@/lib/highlighting/state/service'
import type { DiffAttachment } from '@/lib/diff-attachment'
import { Editor } from '@singapore-editor/core/editor'
import type {
  EditorViewSnapshot,
  EditorViewContributionContext,
} from '@singapore-editor/core/extensions'
import {
  bindDiffPlugin,
  createDiffPresentationBinding,
} from '@/features/editor/state/diff-presentation'
import {
  createTabPresentation,
  type DiffPanePresentation,
  type DiffPanePublicationSink,
} from '@/features/editor/state/tab-presentation'
import { onTestFinished, vi } from 'vitest'

export function projectionControl(
  file: DiffFile,
  subject = file.path,
  revision = 'initial',
): DiffAttachment {
  return { kind: 'projection-control', subject, revision, file }
}

export function observeDiffEditors() {
  const installations: {
    readonly editor: Editor
    readonly request: Parameters<Editor['openDocument']>[0]
  }[] = []
  const mounted: {
    editor: Editor
    context: EditorViewContributionContext | null
    delivered: EditorViewSnapshot | null
  }[] = []
  const editors = new Map<
    DiffGutterSide,
    {
      editor: Editor
      context: EditorViewContributionContext | null
      delivered: EditorViewSnapshot | null
    }
  >()
  const openDocument = Editor.prototype.openDocument
  const observed = vi.spyOn(Editor.prototype, 'openDocument').mockImplementation(function (
    this: Editor,
    ...args: Parameters<Editor['openDocument']>
  ) {
    const result = openDocument.apply(this, args)
    const id = args[0].documentId
    const side = observedSide(id)
    if (!id?.startsWith('projection:diff:')) return result
    installations.push({ editor: this, request: args[0] })
    if (editors.get(side)?.editor === this) return result
    const entry: {
      editor: Editor
      context: EditorViewContributionContext | null
      delivered: EditorViewSnapshot | null
    } = {
      editor: this,
      context: null,
      delivered: null,
    }
    editors.set(side, entry)
    mounted.push(entry)
    this.addPlugin({
      name: 'diff-editor-observer',
      activate: (owner) =>
        owner.registerViewContribution({
          createContribution(context) {
            entry.context = context
            return {
              update(snapshot) {
                entry.delivered = snapshot
              },
              dispose() {
                entry.context = null
                entry.delivered = null
              },
            }
          },
        }),
    })
    return result
  })
  onTestFinished(() => observed.mockRestore())
  return {
    installations,
    all() {
      return mounted.filter((entry) => entry.context !== null)
    },
    read(side: DiffGutterSide) {
      const entry = editors.get(side)
      if (!entry?.context) throw new RangeError('Actual diff editor observer is unavailable')
      return {
        editor: entry.editor,
        snapshot: entry.context.getSnapshot(),
        delivered: entry.delivered,
      }
    },
  }
}

export function captureDiffSnapshot(snapshot: EditorViewSnapshot) {
  return {
    documentId: snapshot.documentId,
    languageId: snapshot.languageId,
    text: snapshot.textSnapshot.readRange(0, snapshot.textSnapshot.length),
    textVersion: snapshot.textVersion,
    syncPoint: snapshot.documentSyncPoint,
    tokens: snapshot.tokens.toTokens(),
    theme: snapshot.theme,
    syntaxStatus: snapshot.syntaxStatus,
    initialHighlightStatus: snapshot.initialHighlightStatus,
    visible: snapshot.toVisibleSnapshot()?.toJSON() ?? null,
  }
}

export function observeDiffSyntaxLoans() {
  const service = highlightingService()
  const loans: {
    readonly file: DiffFile
    readonly side: DiffGutterSide
    readonly backend: ReturnType<typeof service.documentBackend>
    readonly theme: ReturnType<Parameters<typeof service.showDiff>[3]['current']>
    readers: readonly DiffSyntaxSourceReader[] | null
    failed: boolean
    released: boolean
  }[] = []
  const holds: {
    readers: readonly DiffSyntaxSourceReader[] | null
    readonly completion: ReturnType<typeof Promise.withResolvers<void>>
  }[] = []
  let holdNext = false
  const showDiff = service.showDiff
  const observed = vi.spyOn(service, 'showDiff').mockImplementation((view, file, side, theme) => {
    const loan: (typeof loans)[number] = {
      file,
      side,
      backend: service.documentBackend(theme),
      theme: theme.current(),
      readers: null,
      failed: false,
      released: false,
    }
    loans.push(loan)
    const held: (typeof holds)[number] | null = holdNext
      ? { readers: null, completion: Promise.withResolvers<void>() }
      : null
    holdNext = false
    if (held) holds.push(held)
    const shown = showDiff.call(
      service,
      {
        setFile(source, prepared: PreparedDiffSyntaxInput = []) {
          if (!held) {
            if (prepared instanceof Promise)
              void prepared.then(
                (readers) => {
                  loan.readers = readers
                },
                () => {
                  loan.failed = true
                },
              )
            else loan.readers = prepared
            view.setFile(source, prepared)
            return
          }
          const delivered = Promise.resolve(prepared).then(async (readers) => {
            loan.readers = readers
            held.readers = readers
            await held.completion.promise
            return readers
          })
          view.setFile(source, delivered)
        },
        releaseSyntax: () => view.releaseSyntax?.(),
      },
      file,
      side,
      theme,
    )
    return {
      dispose() {
        loan.released = true
        shown.dispose()
      },
    }
  })
  onTestFinished(() => {
    for (const held of holds) held.completion.resolve()
    observed.mockRestore()
  })
  return {
    loans,
    holds,
    holdNext: () => {
      holdNext = true
    },
    service,
  }
}

export function mountDiffProjectionControl(
  initial: DiffAttachment,
  side: DiffGutterSide = 'stacked',
  presentation: DiffPanePresentation = createTabPresentation().diffPanes[side],
  onPublication?: DiffPanePublicationSink,
) {
  const host = document.createElement('div')
  document.body.append(host)
  const regions = createDiffRegionStore()
  const plugin = createDiffPlugin({ mode: 'document', side, regions, syntaxHighlight: false })
  const releasePlugin = bindDiffPlugin(presentation, plugin)
  const binding = createDiffPresentationBinding(presentation, side, onPublication)
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
    releasePlugin()
    binding.detach()
    editor.dispose()
    host.remove()
  })
  return {
    host,
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
    context() {
      if (!context) throw new RangeError('Diff control view is missing')
      return context
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

function observedSide(id: string | undefined): DiffGutterSide {
  if (id?.endsWith(':old')) return 'old'
  if (id?.endsWith(':new')) return 'new'
  return 'stacked'
}
