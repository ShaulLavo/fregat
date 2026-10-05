import type { Editor, EditorPlugin } from '@singapore-editor/core/editor'

export function addLayoutReservation(
  editor: Editor,
  width: number,
  identify: (value: object) => number | null,
) {
  let disposed = false
  let activatedAt: number | null = null
  let disposedAt: number | null = null
  let contributionIdentity: number | null = null
  let read: (() => { left: number; right: number }) | null = null
  const plugin: EditorPlugin = {
    name: 'retention-layout-reservation',
    activate(context) {
      return [
        context.registerViewContribution({
          createContribution(view) {
            activatedAt = performance.now()
            view.reserveOverlayWidth('left', width)
            read = () => ({
              left: view.getReservedOverlayWidth('left'),
              right: view.getReservedOverlayWidth('right'),
            })
            const contribution = {
              update() {},
              dispose() {
                view.reserveOverlayWidth('left', 0)
                disposed = true
                disposedAt = performance.now()
                read = null
              },
            }
            contributionIdentity = identify(contribution)
            return contribution
          },
        }),
      ]
    },
  }
  const claim = editor.addPlugin(plugin)
  return {
    claim,
    capture: () => ({
      nativeEditorIdentity: identify(editor),
      contributionIdentity,
      requestedWidth: width,
      disposed,
      activatedAt,
      disposedAt,
      actual: read?.() ?? null,
    }),
  }
}
