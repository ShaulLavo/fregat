import type { Editor, EditorPlugin } from '@singapore-editor/core/editor'

export function addLayoutReservation(editor: Editor, width: number) {
  let disposed = false
  let read: (() => { left: number; right: number }) | null = null
  const plugin: EditorPlugin = {
    name: 'retention-layout-reservation',
    activate(context) {
      return [
        context.registerViewContribution({
          createContribution(view) {
            view.reserveOverlayWidth('left', width)
            read = () => ({
              left: view.getReservedOverlayWidth('left'),
              right: view.getReservedOverlayWidth('right'),
            })
            return {
              update() {},
              dispose() {
                view.reserveOverlayWidth('left', 0)
                disposed = true
                read = null
              },
            }
          },
        }),
      ]
    },
  }
  const claim = editor.addPlugin(plugin)
  return { claim, capture: () => ({ requestedWidth: width, disposed, actual: read?.() ?? null }) }
}
