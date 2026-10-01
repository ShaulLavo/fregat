import type { EditorPlugin } from '@singapore-editor/core/extensions'
import {
  createBracketMatchPlugin,
  createDocumentLinkPlugin,
  createMergeConflictPlugin,
  createOccurrenceHighlightPlugin,
} from '@singapore-editor/core'
import { createLineGutterPlugin } from '@singapore-editor/gutters/line-gutter'
import { createFoldGutterPlugin } from '@singapore-editor/gutters/fold-gutter'
import { createScopeLinesPlugin } from '@singapore-editor/scope-lines'

export function inputPlatformPlugins(analysis: boolean): EditorPlugin[] {
  const plugins = [createLineGutterPlugin()]
  if (!analysis) return plugins
  plugins.push(
    createMergeConflictPlugin(),
    createBracketMatchPlugin(),
    createOccurrenceHighlightPlugin(),
    createDocumentLinkPlugin(),
    createFoldGutterPlugin(),
    createScopeLinesPlugin(),
  )
  return plugins
}
