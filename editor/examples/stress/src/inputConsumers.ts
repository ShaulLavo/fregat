import type { Editor } from '@singapore-editor/core/editor'
import type { EditorPlugin } from '@singapore-editor/core/extensions'
import { createShikiHighlighterPlugin, createShikiWorkerOwner } from '@singapore-editor/core/shiki'
import { createEditorFindPlugin } from '@singapore-editor/find'
import { createMinimapPlugin } from '@singapore-editor/minimap'
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
import { inputPlatformPlugins } from './inputPlatformPlugins.ts'
import { awaitInputStage, inputReadyDelay, waitForInputReady } from './inputReadiness.ts'

export function createInputConsumers(id: string, fixture: string, length: number) {
  const configuration = inputConsumerConfiguration(id, fixture, length)
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
  if (configuration.platform) plugins.push(...inputPlatformPlugins(configuration.analysis))
  return {
    configuration,
    plugins,
    async settle(editors: readonly Editor[]) {
      const startedAt = performance.now()
      const deadline = startedAt + 30_000
      const syntax = configuration.treeSitter || configuration.shiki
      // A line over Shiki's limit is plain by policy, so live tokens cannot be required for it.
      const tokensLive = () =>
        !syntax ||
        (shiki ? (shikiSnapshot(shiki).untokenizedLines ?? 0) > 0 : false) ||
        [...CSS.highlights].some(
          ([name, ranges]) => name.startsWith('editor-shared-token-') && ranges.size > 0,
        )
      const observe = () => ({
        treePending: tree?.inspect().pendingRequests ?? 0,
        shikiPending: shiki?.inspect().pendingRequests ?? 0,
        initialHighlights: editors.map((editor) => editor.getState().initialHighlightStatus),
        minimapReady: minimapRendersAccepted(),
        tokensLive: tokensLive(),
      })
      const quiet = () =>
        (tree?.inspect().pendingRequests ?? 0) === 0 &&
        (shiki?.inspect().pendingRequests ?? 0) === 0 &&
        tokensLive()
      // Syntax sessions start lazily; a fence taken before they start resolves with nothing done.
      await waitForInputReady(
        'initial highlights',
        deadline,
        () => editors.every((editor) => editor.getState().initialHighlightStatus !== 'loading'),
        observe,
      )
      do {
        if (tree)
          await awaitInputStage('Tree-sitter idle fence', deadline, observe, () =>
            tree.awaitIdleFence(),
          )
        if (shiki)
          await awaitInputStage('Shiki idle fence', deadline, observe, () => shiki.awaitIdleFence())
        if (configuration.minimap)
          await waitForInputReady(
            'minimap render acceptance',
            deadline,
            minimapRendersAccepted,
            observe,
          )
        // Fences resolve before follow-up syntax requests start; readiness yields and checks again.
        await awaitInputStage('follow-up syntax readiness', deadline, observe, () =>
          inputReadyDelay(50),
        )
      } while (!quiet())
      return {
        configuration,
        settleMs: performance.now() - startedAt,
        tree: tree?.inspect() ?? null,
        shiki: shiki ? shikiSnapshot(shiki) : null,
        plugins: plugins.map((plugin) => plugin.name ?? 'unnamed'),
        views: editors.map((editor, index) => {
          const host = document.getElementById(`view-${index}`)
          return {
            initialHighlightStatus: editor.getState().initialHighlightStatus,
            visible: host?.checkVisibility() ?? false,
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
      const deadline = performance.now() + 30_000
      const observe = () => ({
        treePending: tree?.inspect().pendingRequests ?? 0,
        shikiPending: shiki?.inspect().pendingRequests ?? 0,
      })
      await Promise.all([
        tree && awaitInputStage('Tree-sitter disposal', deadline, observe, () => tree.dispose()),
        shiki && awaitInputStage('Shiki disposal', deadline, observe, () => shiki.dispose()),
      ])
    },
  }
}

type WorkerProof = {
  readonly terminated: boolean
  readonly minimap: boolean
  readonly latestRender: number
  readonly acceptedRender: number
}

// Minimap renders arrive after the syntax fences; readiness checks the latest requested frame.
function minimapRendersAccepted() {
  return (
    (globalThis as { __inputWorkerProof?: readonly WorkerProof[] }).__inputWorkerProof ?? []
  ).every(
    (worker) =>
      worker.terminated ||
      !worker.minimap ||
      (worker.latestRender > 0 && worker.acceptedRender === worker.latestRender),
  )
}

// Plain-line fields exist only in packages with the tokenization line limit; older sets report null.
function shikiSnapshot(owner: ReturnType<typeof createShikiWorkerOwner>) {
  const snapshot: ReturnType<typeof owner.inspect> & {
    readonly maxTokenizationLineLength?: number
    readonly untokenizedLines?: number
  } = owner.inspect()
  return {
    ...snapshot,
    maxTokenizationLineLength: snapshot.maxTokenizationLineLength ?? null,
    untokenizedLines: snapshot.untokenizedLines ?? null,
  }
}
