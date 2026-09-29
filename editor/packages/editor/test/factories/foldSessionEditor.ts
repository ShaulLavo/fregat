import type { DocumentSession } from '../../src/documentSession'
import type { EditorViewSnapshot } from '../../src/public/extensions'
import type { EditorSessionOptions } from '../../src/editor/types'
import { createVisibleEditor } from './visibleEditor'

export function createFoldSessionEditor(
  session: DocumentSession,
  options: EditorSessionOptions = {},
) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let markers: EditorViewSnapshot['foldMarkers'] = []
  const editor = createVisibleEditor(container, {
    plugins: [
      {
        activate: (context) =>
          context.registerViewContribution({
            createContribution: () => ({
              update: (snapshot) => {
                markers = snapshot.foldMarkers
              },
              dispose: () => undefined,
            }),
          }),
      },
    ],
  })
  editor.attachSession(session, options)
  return {
    editor,
    markers: () => markers,
    dispose: () => {
      editor.dispose()
      container.remove()
    },
  }
}
