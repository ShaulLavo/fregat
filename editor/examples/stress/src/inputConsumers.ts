import type { Editor } from '@singapore-editor/core/editor'
import type { EditorPlugin } from '@singapore-editor/core/extensions'
import {
  createBracketMatchPlugin,
  createDocumentLinkPlugin,
  createMergeConflictPlugin,
  createOccurrenceHighlightPlugin,
} from '@singapore-editor/core'
import { createShikiHighlighterPlugin, createShikiWorkerOwner } from '@singapore-editor/core/shiki'
import { createEditorFindPlugin } from '@singapore-editor/find'
import { createLineGutterPlugin } from '@singapore-editor/gutters/line-gutter'
import { createFoldGutterPlugin } from '@singapore-editor/gutters/fold-gutter'
import { createMinimapPlugin } from '@singapore-editor/minimap'
import { createScopeLinesPlugin } from '@singapore-editor/scope-lines'
import {
  createTreeSitterSyntaxProvider,
  createTreeSitterSyntaxPlugin,
  TreeSitterWorkerClient,
} from '@singapore-editor/tree-sitter'
import {
  TREE_SITTER_LANGUAGE_CONTRIBUTIONS,
  TYPESCRIPT_TREE_SITTER_LANGUAGE,
  typeScript,
} from '@singapore-editor/tree-sitter-languages'
import typescript from '@shikijs/langs/typescript'
import githubDark from '@shikijs/themes/github-dark'
import { inputConsumerConfiguration } from '../input-configurations.mjs'

export function createInputConsumers(id: string, fixture: string) {
  const configuration = inputConsumerConfiguration(id, fixture)
  const plugins: EditorPlugin[] = []
  const tree = configuration.treeSitter && id !== 'native' ? new TreeSitterWorkerClient() : null
  const shiki = configuration.shiki ? createShikiWorkerOwner() : null
  if (tree) {
    const provider = createTreeSitterSyntaxProvider({ backend: tree })
    provider.registerLanguage(TYPESCRIPT_TREE_SITTER_LANGUAGE)
    for (const contribution of TREE_SITTER_LANGUAGE_CONTRIBUTIONS)
      if (contribution.id !== 'typescript') provider.registerLanguage(contribution)
    plugins.push(createTreeSitterSyntaxPlugin(provider))
  }
  if (id === 'native' && configuration.treeSitter) plugins.push(typeScript())
  if (shiki)
    plugins.push(
      createShikiHighlighterPlugin({
        workerOwner: shiki,
        resolveLanguage: async () => typescript,
        resolveTheme: async () => ({ ...githubDark, name: 'github-dark' }),
      }),
    )
  if (configuration.minimap) plugins.push(createMinimapPlugin())
  if (configuration.find) plugins.push(createEditorFindPlugin())
  if (configuration.platform)
    plugins.push(
      createLineGutterPlugin(),
      createFoldGutterPlugin(),
      createMergeConflictPlugin(),
      createBracketMatchPlugin(),
      createOccurrenceHighlightPlugin(),
      createDocumentLinkPlugin(),
      createScopeLinesPlugin(),
    )
  return {
    configuration,
    plugins,
    async settle(editors: readonly Editor[]) {
      await tree?.awaitIdleFence()
      await shiki?.awaitIdleFence()
      return {
        configuration,
        tree: tree?.inspect() ?? null,
        shiki: shiki?.inspect() ?? null,
        views: editors.map((editor) => ({
          initialHighlightStatus: editor.getState().initialHighlightStatus,
        })),
      }
    },
    async dispose() {
      await Promise.all([tree?.dispose(), shiki?.dispose()])
    },
  }
}
