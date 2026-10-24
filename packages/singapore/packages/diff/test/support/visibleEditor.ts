import { Editor } from '@singapore-editor/core/editor'
import { VirtualizedTextView } from '@singapore-editor/core/testing'

export function createVisibleEditor(...args: ConstructorParameters<typeof Editor>): Editor {
  const editor = new Editor(...args)
  const view: unknown = Reflect.get(editor, 'view')
  // happy-dom has no layout, so deliver the first visible viewport measurement explicitly.
  if (view instanceof VirtualizedTextView) {
    view.scrollElement.getBoundingClientRect = () => new DOMRect(0, 0, 640, 240)
    view.setScrollMetrics(0, 240, 640)
  }
  return editor
}
