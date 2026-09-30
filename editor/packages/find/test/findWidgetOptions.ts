import type { EditorFindWidgetOptions } from '../src/findWidget'

export function widgetOptions(): EditorFindWidgetOptions {
  const noop = (): void => undefined
  return {
    onSearchInput: noop,
    onReplaceInput: noop,
    onToggleReplace: noop,
    onPrevious: noop,
    onNext: noop,
    onClose: noop,
    onToggleCase: noop,
    onToggleWholeWord: noop,
    onToggleRegex: noop,
    onToggleScope: noop,
    onTogglePreserveCase: noop,
    onReplaceOne: noop,
    onReplaceAll: noop,
  }
}
