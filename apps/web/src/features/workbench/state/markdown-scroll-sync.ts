import type {
  EditorPlugin,
  EditorViewContributionContext,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'

/**
 * Keeps a markdown source editor and its rendered pane on the same place. The editor half is a
 * view contribution: it reports the first document line on screen and scrolls a line to the top.
 * Each side ignores the scroll the other just caused, so the two never chase each other.
 */
export function createMarkdownScrollSync() {
  let context: EditorViewContributionContext | null = null
  let quietUntil = 0
  const listeners = new Set<(line: number) => void>()

  const report = (view: EditorViewSnapshot) => {
    if (performance.now() < quietUntil) return
    const line = topBufferRow(view)
    if (line === null) return
    for (const listener of listeners) listener(line)
  }

  const plugin: EditorPlugin = {
    name: 'platform-markdown-scroll-sync',
    activate: (pluginContext) =>
      pluginContext.registerViewContribution({
        createContribution: (viewContext) => {
          context = viewContext
          return {
            update: (view, kind) => {
              if (kind === 'viewport') report(view)
            },
            dispose: () => {
              context = null
            },
          }
        },
      }),
  }

  return {
    plugin,
    /** The zero-based source line now at the top of the editor, as the user scrolls. */
    subscribe(listener: (line: number) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** Scrolls the editor so zero-based `line` is at the top, without echoing it back. */
    revealLine(line: number) {
      if (!context) return
      quietUntil = performance.now() + 150
      context.revealLine(line)
    },
  }
}

export type MarkdownScrollSync = ReturnType<typeof createMarkdownScrollSync>

function topBufferRow(view: EditorViewSnapshot) {
  const top = Math.floor(view.viewport.scrollRow)
  const row = view.visibleRows.find((candidate) => candidate.index >= top)
  return row ? row.bufferRow : null
}
