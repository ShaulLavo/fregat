import type { EditorPlugin } from '@singapore-editor/core/extensions'
import type { TreeSitterSyntaxProvider, TreeSitterWorkerOwner } from '@singapore-editor/tree-sitter'

export type InputProductTree = {
  readonly owner: Pick<TreeSitterWorkerOwner, 'inspect' | 'awaitIdleFence' | 'dispose'>
  readonly api: 'owned-operation' | 'legacy-session'
  readonly registerLanguage: TreeSitterSyntaxProvider['registerLanguage']
  plugin(): EditorPlugin
}

export function createInputProductTree(): InputProductTree
