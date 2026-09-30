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
    for (const contribution of TREE_SITTER_LANGUAGE_CONTRIBUTIONS)
      provider.registerLanguage(contribution, { replace: true })
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
      // Syntax sessions start lazily; a fence taken before they start resolves with nothing done.
      await until(() =>
        editors.every((editor) => editor.getState().initialHighlightStatus !== 'loading'),
      )
      await tree?.awaitIdleFence()
      await shiki?.awaitIdleFence()
      if (configuration.minimap) await minimapRendersAccepted()
      return {
        configuration,
        tree: tree?.inspect() ?? null,
        shiki: shiki?.inspect() ?? null,
        plugins: plugins.map((plugin) => plugin.name ?? 'unnamed'),
        views: editors.map((editor, index) => {
          const host = document.getElementById(`view-${index}`)
          return {
            initialHighlightStatus: editor.getState().initialHighlightStatus,
            gutterElements:
              host?.querySelectorAll(
                '.editor-virtualized-gutter-label, .editor-virtualized-fold-gutter-cell',
              ).length ?? 0,
            minimapElements: host?.querySelectorAll('[class*="minimap"]').length ?? 0,
          }
        }),
      }
    },
    async dispose() {
      await Promise.all([tree?.dispose(), shiki?.dispose()])
    },
  }
}

type WorkerProof = {
  readonly terminated: boolean
  readonly minimap: boolean
  readonly latestRender: number
  readonly acceptedRender: number
}

async function until(settled: () => boolean, timeoutMs = 30_000) {
  const deadline = performance.now() + timeoutMs
  while (!settled() && performance.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 16))
}

// Minimap renders arrive after the syntax fences; readiness waits for the latest requested frame.
async function minimapRendersAccepted() {
  await until(() =>
    (
      (globalThis as { __inputWorkerProof?: readonly WorkerProof[] }).__inputWorkerProof ?? []
    ).every(
      (worker) =>
        worker.terminated ||
        !worker.minimap ||
        (worker.latestRender > 0 && worker.acceptedRender === worker.latestRender),
    ),
  )
}
