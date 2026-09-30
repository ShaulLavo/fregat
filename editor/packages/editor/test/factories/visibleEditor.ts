import { Editor } from '../../src/editor'
import { VirtualizedTextView } from '../../src/virtualization'

export function createVisibleEditor(...args: ConstructorParameters<typeof Editor>): Editor {
  const editor = new Editor(...args)
  const view: unknown = Reflect.get(editor, 'view')
  // happy-dom has no layout, so visible tests deliver the first measurement explicitly.
  if (view instanceof VirtualizedTextView) view.setScrollMetrics(0, 24)
  return editor
}
