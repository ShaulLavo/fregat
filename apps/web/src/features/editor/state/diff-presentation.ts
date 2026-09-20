import type { Editor, EditorPlugin, EditorViewContributionContext } from '@singapore-editor/core'
import type { DiffPanePresentation } from '@/features/editor/state/tab-presentation'

export function createDiffPresentationBinding(presentation: DiffPanePresentation) {
  let view: EditorViewContributionContext | null = null
  let restored = false

  function capture() {
    if (!view || !restored) return
    const snapshot = view.getSnapshot()
    presentation.selections = snapshot.selections
    presentation.scroll = { left: snapshot.viewport.scrollLeft, top: snapshot.viewport.scrollTop }
  }

  function dispose() {
    capture()
    view = null
    restored = false
  }

  function createContribution(current: EditorViewContributionContext) {
    view = current
    return { update: capture, dispose }
  }

  const plugin: EditorPlugin = {
    name: 'platform-diff-presentation',
    activate: (context) => context.registerViewContribution({ createContribution }),
  }

  return {
    plugin,
    detach() {
      capture()
      restored = false
    },
    restore(editor: Editor) {
      if (restored || !view) return
      const selections = presentation.selections
      const scroll = presentation.scroll
      const length = editor.getState().length
      if (selections.length > 0) {
        view.setSelections(
          selections.map((selection) => ({
            anchor: Math.min(selection.anchorOffset, length),
            head: Math.min(selection.headOffset, length),
          })),
          'editor.restoreDiffSelection',
        )
      }
      if (scroll) editor.setScrollPosition(scroll)
      restored = true
    },
  }
}
